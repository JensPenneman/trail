import { sql } from "drizzle-orm";
import type { Database, Executor } from "../db/database";
import { queuePriority, readyNow } from "./processingQueue";

interface StateRow extends Record<string, unknown> {
  version: number | null;
}

/**
 * The boot-time backfill (docs/architecture.md §17.4): when the history was
 * processed by another version of the algorithms (or never), every day of
 * every device with points is queued at low priority — the worker takes the
 * newest days first and new data before any of them. The queue is a table, so
 * an interrupted backfill resumes after a restart; the version is recorded in
 * the same transaction, so it is queued once. Returns the number of days.
 */
export async function enqueueBackfill(db: Database, version: number): Promise<number> {
  return db.transaction(async (tx) => {
    const state = await tx.execute<StateRow>(sql`
      SELECT (value->>'version')::int AS version FROM processing_state WHERE key = 'backfill' FOR UPDATE
    `);
    if (state.rows[0]?.version === version) return 0;
    const queued = await tx.execute(sql`
      INSERT INTO processing_queue (device_id, from_at, to_at, reason, priority, next_at)
      SELECT s.device_id, (s.date::timestamp AT TIME ZONE u.timezone),
        ((s.date + 1)::timestamp AT TIME ZONE u.timezone), 'backfill', ${queuePriority.backfill},
        ${readyNow}
      FROM daily_stats s
      JOIN devices d ON d.id = s.device_id
      JOIN users u ON u.id = d.user_id
      WHERE s.points > 0
      ON CONFLICT (device_id, from_at) DO UPDATE SET
        to_at = greatest(processing_queue.to_at, excluded.to_at), enqueued_at = now()
    `);
    await tx.execute(sql`
      INSERT INTO processing_state (key, value, updated_at)
      VALUES ('backfill', ${JSON.stringify({ version })}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    return queued.rowCount ?? 0;
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
