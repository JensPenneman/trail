import { sql } from "drizzle-orm";
import type { Database, Executor } from "../db/database";
import { type FromLevel, queuePriority, readyNow } from "./processingQueue";
import type { ProcessingVersions } from "./processingVersion";

/** The levels, the most thorough first (the queue's order). */
const levels: readonly FromLevel[] = ["averaged", "mapped", "inferred"];
const levelOrder = sql.raw("ARRAY['averaged', 'mapped', 'inferred']");

interface StateRow extends Record<string, unknown> {
  value: unknown;
}

/**
 * The versions in a `processing_state` value: `{ versions: { averaged,
 * mapped, inferred } }`, or `{ version }` from before the levels had versions
 * of their own, which every level was at. Null when there are none.
 */
function recordedVersions(value: unknown): Partial<Record<FromLevel, unknown>> | null {
  if (typeof value !== "object" || value === null) return null;
  const { versions, version } = value as { versions?: unknown; version?: unknown };
  if (typeof versions === "object" && versions !== null) {
    return versions as Partial<Record<FromLevel, unknown>>;
  }
  return typeof version === "number"
    ? { averaged: version, mapped: version, inferred: version }
    : null;
}

/**
 * The level the backfill works the history out again from (docs/architecture.md
 * §17.4): the lowest whose version differs from the one recorded for the
 * history (`recorded`, the `processing_state` value; averaged when the history
 * was never processed), or null when every level is current.
 */
export function backfillLevel(recorded: unknown, current: ProcessingVersions): FromLevel | null {
  const versions = recordedVersions(recorded);
  return levels.find((level) => versions?.[level] !== current[level]) ?? null;
}

/**
 * The boot-time backfill (docs/architecture.md §17.4): when the history was
 * processed by other versions of the algorithms (or never), every day of
 * every device with points is queued at low priority from the lowest level
 * that changed — the worker takes the newest days first and new data before
 * any of them. A day already queued keeps the more thorough of its level and
 * this one. The queue is a table, so an interrupted backfill resumes after a
 * restart; the versions are recorded in the same transaction, so it is queued
 * once. Returns the number of days and their level (null: nothing changed).
 */
export async function enqueueBackfill(
  db: Database,
  versions: ProcessingVersions,
): Promise<{ days: number; fromLevel: FromLevel | null }> {
  return db.transaction(async (tx) => {
    const state = await tx.execute<StateRow>(sql`
      SELECT value FROM processing_state WHERE key = 'backfill' FOR UPDATE
    `);
    const fromLevel = backfillLevel(state.rows[0]?.value ?? null, versions);
    if (fromLevel === null) return { days: 0, fromLevel };
    const queued = await tx.execute(sql`
      INSERT INTO processing_queue (device_id, from_at, to_at, reason, from_level, priority, next_at)
      SELECT s.device_id, (s.date::timestamp AT TIME ZONE u.timezone),
        ((s.date + 1)::timestamp AT TIME ZONE u.timezone), 'backfill', ${fromLevel},
        ${queuePriority.backfill}, ${readyNow}
      FROM daily_stats s
      JOIN devices d ON d.id = s.device_id
      JOIN users u ON u.id = d.user_id
      WHERE s.points > 0
      ON CONFLICT (device_id, from_at) DO UPDATE SET
        to_at = greatest(processing_queue.to_at, excluded.to_at),
        from_level = CASE
          WHEN array_position(${levelOrder}, excluded.from_level) < array_position(${levelOrder}, processing_queue.from_level)
          THEN excluded.from_level ELSE processing_queue.from_level END,
        enqueued_at = now()
    `);
    await tx.execute(sql`
      INSERT INTO processing_state (key, value, updated_at)
      VALUES ('backfill', ${JSON.stringify({ versions })}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    return { days: queued.rowCount ?? 0, fromLevel };
  });
}

/**
 * A safety net for windows lost between an upload and its queueing (the
 * process stopped in between): a device whose newest point is more than a
 * quarter of an hour newer than its newest processed point, with nothing
 * queued for it, gets the gap queued. Devices never processed are the
 * backfill's. Returns the number of devices.
 */
export async function enqueueCatchUp(db: Executor): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO processing_queue (device_id, from_at, to_at, reason, priority, next_at)
    SELECT d.id, processed.last - interval '30 minutes', recorded.last + interval '1 second',
      'catch-up', ${queuePriority.normal}, ${readyNow}
    FROM devices d
    CROSS JOIN LATERAL (SELECT max(recorded_at) AS last FROM locations WHERE device_id = d.id) recorded
    CROSS JOIN LATERAL (SELECT max(recorded_at) AS last FROM processed_points WHERE device_id = d.id) processed
    WHERE recorded.last IS NOT NULL AND processed.last IS NOT NULL
      AND processed.last < recorded.last - interval '15 minutes'
      AND recorded.last < now() - interval '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM processing_queue q WHERE q.device_id = d.id AND q.to_at >= recorded.last
      )
    ON CONFLICT (device_id, from_at) DO NOTHING
  `);
  return result.rowCount ?? 0;
}
