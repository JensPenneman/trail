import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type { TileKey } from "./tileCover";

/** Where a window's processing starts: everything, from map matching on, or only the inference. */
export type FromLevel = "averaged" | "mapped" | "inferred";

/** Why a window was queued (for the log and the operator). */
export type QueueReason =
  | "ingest"
  | "delete"
  | "reprocess"
  | "backfill"
  | "override"
  | "map"
  | "catch-up"
  | "split";

/**
 * The order of the work (docs/architecture.md §17.4): new data from the
 * phones first, then repair — a deletion, a corrected mode, the catch-up,
 * `trail reprocess`, the older parts of an upload's window too big for one
 * pass — then the backfill of older history.
 */
export const queuePriority = { live: 0, repair: 1, backfill: 2 } as const;

/** The priority of a reason's windows, unless the caller says otherwise. */
function priorityOf(reason: QueueReason): number {
  if (reason === "ingest") return queuePriority.live;
  return reason === "backfill" ? queuePriority.backfill : queuePriority.repair;
}

/**
 * A device's live passes are at least this far apart (docs/architecture.md
 * §17.4): an upload's window is ready no sooner than this after the device's
 * last pass began, and one queued while a pass ran waits this long after it
 * ended, so a phone uploading every few seconds costs a pass per half minute.
 */
export const livePassIntervalMs = 30_000;

const livePassInterval = sql`(${livePassIntervalMs}::integer * interval '1 millisecond')`;

/**
 * The database's time to the millisecond, for `next_at`: the worker asks for
 * windows ready by its own clock, which has milliseconds only, so a window
 * made ready now must not lie a fraction of a millisecond ahead of it.
 */
export const readyNow = sql.raw("date_trunc('milliseconds', now())");

export interface QueueRow {
  deviceId: string;
  from: Date;
  to: Date;
  reason: QueueReason;
  fromLevel: FromLevel;
  priority: number;
  attempts: number;
  enqueuedAt: string;
}

interface QueueSqlRow extends Record<string, unknown> {
  device_id: string;
  from_at: string;
  to_at: string;
  reason: QueueReason;
  from_level: FromLevel;
  priority: number;
  attempts: number;
  enqueued_at: string;
}

const toRow = (row: QueueSqlRow): QueueRow => ({
  deviceId: row.device_id,
  from: new Date(toIso(row.from_at)),
  to: new Date(toIso(row.to_at)),
  reason: row.reason,
  fromLevel: row.from_level,
  priority: row.priority,
  attempts: row.attempts,
  // Kept as Postgres wrote it: the version a finished window compares against.
  enqueuedAt: row.enqueued_at,
});

const levelOrder = sql.raw("ARRAY['averaged', 'mapped', 'inferred']");

/**
 * When a live window of the device may run: not before `at`, not sooner than
 * the pass interval after the device's last pass began (when it wrote the
 * newest processed point), and not before a live window of the device that
 * already waits for its turn, so that the uploads in between run with it.
 */
function liveReadyAt(deviceId: string, at: SQL): SQL {
  return sql`greatest(${at},
    (SELECT date_trunc('milliseconds', p.processed_at) + ${livePassInterval} FROM processed_points p
      WHERE p.device_id = ${deviceId} ORDER BY p.recorded_at DESC LIMIT 1),
    (SELECT max(q.next_at) FROM processing_queue q
      WHERE q.device_id = ${deviceId} AND q.priority = ${queuePriority.live}
        AND q.missing_tiles IS NULL AND q.attempts = 0))`;
}

/**
 * Queues a window of a device's history (docs/architecture.md §17.4), at the
 * priority of its reason unless one is given; an upload's window waits for
 * the device's pass interval (`liveReadyAt`). A window with the same start
 * widens the queued one; the worker merges overlapping windows when it takes
 * them. Merging keeps the more thorough level and the higher priority, and
 * makes the window ready at the earlier time.
 */
export async function enqueueWindow(
  db: Executor,
  window: {
    deviceId: string;
    from: Date;
    to: Date;
    reason: QueueReason;
    fromLevel?: FromLevel;
    priority?: number;
    /** Ready at; now by default. */
    at?: Date;
  },
): Promise<void> {
  if (window.to <= window.from) return;
  const level = window.fromLevel ?? "averaged";
  const priority = window.priority ?? priorityOf(window.reason);
  const at = sql`${(window.at ?? new Date()).toISOString()}::timestamptz`;
  await db.execute(sql`
    INSERT INTO processing_queue (device_id, from_at, to_at, reason, from_level, priority, next_at)
    VALUES (${window.deviceId}, ${window.from.toISOString()}::timestamptz,
      ${window.to.toISOString()}::timestamptz, ${window.reason}, ${level}, ${priority},
      ${priority === queuePriority.live ? liveReadyAt(window.deviceId, at) : at})
    ON CONFLICT (device_id, from_at) DO UPDATE SET
      to_at = greatest(processing_queue.to_at, excluded.to_at),
      reason = excluded.reason,
      from_level = CASE
        WHEN array_position(${levelOrder}, excluded.from_level) < array_position(${levelOrder}, processing_queue.from_level)
        THEN excluded.from_level ELSE processing_queue.from_level END,
      priority = least(processing_queue.priority, excluded.priority),
      next_at = least(processing_queue.next_at, excluded.next_at),
      missing_tiles = NULL,
      enqueued_at = now()
  `);
}

/**
 * Due by `now` — or, for a live window that waits only for its device's pass
 * interval, by `liveReadyBy` (a flush does not wait for the interval).
 */
const dueBy = (now: Date, liveReadyBy: Date): SQL => sql`next_at <= CASE
    WHEN priority = ${queuePriority.live} AND attempts = 0 AND missing_tiles IS NULL
    THEN ${liveReadyBy.toISOString()}::timestamptz ELSE ${now.toISOString()}::timestamptz END`;

/**
 * The next window to process: new data oldest first, then repair and the
 * backfill newest first (`backfillFirst`: the backfill first, then repair,
 * their turn between passes of new data) — and every ready window of the
 * same device that overlaps it, so one pass covers them all. A window
 * waiting for map tiles, or for a retry, is not taken along: it would be
 * worked out again with every upload, for nothing, before its tiles are
 * there. Nor is the backfill taken along by other work, or the reverse: an
 * upload's pass stays the size of the upload, a backfill day waits its turn.
 */
export async function takeNextWindow(
  db: Executor,
  now: Date,
  options: { backfillFirst?: boolean; liveReadyBy?: Date } = {},
): Promise<QueueRow[]> {
  const order = options.backfillFirst === true ? sql.raw("-priority") : sql.raw("priority");
  const due = dueBy(now, options.liveReadyBy ?? now);
  const head = await db.execute<QueueSqlRow>(sql`
    SELECT device_id, from_at, to_at, reason, from_level, priority, attempts, enqueued_at::text
    FROM processing_queue
    WHERE ${due}
    ORDER BY ${order},
      CASE WHEN priority = 0 THEN extract(epoch FROM next_at) ELSE -extract(epoch FROM from_at) END,
      device_id, from_at
    LIMIT 1
  `);
  const first = head.rows[0];
  if (first === undefined) return [];
  const kind =
    first.priority === queuePriority.backfill
      ? sql`priority = ${queuePriority.backfill}`
      : sql`priority <> ${queuePriority.backfill}`;
  const overlapping = await db.execute<QueueSqlRow>(sql`
    SELECT device_id, from_at, to_at, reason, from_level, priority, attempts, enqueued_at::text
    FROM processing_queue
    WHERE device_id = ${first.device_id}
      AND from_at < ${toIso(first.to_at)}::timestamptz AND to_at > ${toIso(first.from_at)}::timestamptz
      AND (from_at = ${toIso(first.from_at)}::timestamptz
        OR (missing_tiles IS NULL AND ${due} AND ${kind}))
    ORDER BY from_at
  `);
  return overlapping.rows.map(toRow);
}

/**
 * The next queued window of one device within a range, with the ones that
 * overlap it (the CLI works through its own windows this way); waiting
 * windows are skipped: they wait for map data.
 */
export async function takeDeviceWindows(
  db: Executor,
  deviceId: string,
  from: Date,
  to: Date,
): Promise<QueueRow[]> {
  const head = await db.execute<QueueSqlRow>(sql`
    SELECT device_id, from_at, to_at, reason, from_level, priority, attempts, enqueued_at::text
    FROM processing_queue
    WHERE device_id = ${deviceId} AND missing_tiles IS NULL
      AND from_at < ${to.toISOString()}::timestamptz AND to_at > ${from.toISOString()}::timestamptz
    ORDER BY from_at
    LIMIT 1
  `);
  const first = head.rows[0];
  if (first === undefined) return [];
  const overlapping = await db.execute<QueueSqlRow>(sql`
    SELECT device_id, from_at, to_at, reason, from_level, priority, attempts, enqueued_at::text
    FROM processing_queue
    WHERE device_id = ${deviceId} AND missing_tiles IS NULL
      AND from_at < ${toIso(first.to_at)}::timestamptz AND to_at > ${toIso(first.from_at)}::timestamptz
    ORDER BY from_at
  `);
  return overlapping.rows.map(toRow);
}

/** Removes the windows a pass covered — unless they changed meanwhile (new data widened them). */
export async function finishWindows(db: Executor, rows: readonly QueueRow[]): Promise<void> {
  for (const row of rows) {
    await db.execute(sql`
      DELETE FROM processing_queue
      WHERE device_id = ${row.deviceId} AND from_at = ${row.from.toISOString()}::timestamptz
        AND enqueued_at = ${row.enqueuedAt}::timestamptz
    `);
  }
}

/**
 * The end of a pass of new data: a live window of the device still queued —
 * an upload came while the pass ran — waits for the pass interval from now
 * (`livePassIntervalMs`), the uploads after it with it.
 */
export async function deferLiveWindows(db: Executor, deviceId: string): Promise<void> {
  await db.execute(sql`
    UPDATE processing_queue
    SET next_at = greatest(next_at, date_trunc('milliseconds', clock_timestamp()) + ${livePassInterval})
    WHERE device_id = ${deviceId} AND priority = ${queuePriority.live}
      AND missing_tiles IS NULL AND attempts = 0
  `);
}

/** When the next window not waiting for map tiles comes due after `now`, if any is queued. */
export async function nextDueAt(db: Executor, now: Date): Promise<Date | null> {
  const result = await db.execute<{ due: string | null }>(sql`
    SELECT min(next_at)::text AS due FROM processing_queue
    WHERE missing_tiles IS NULL AND next_at > ${now.toISOString()}::timestamptz
  `);
  const due = result.rows[0]?.due ?? null;
  return due === null ? null : new Date(toIso(due));
}

/** A failed pass: the windows are retried later, sooner after the first failures. */
export async function retryWindows(
  db: Executor,
  rows: readonly QueueRow[],
  error: string,
): Promise<void> {
  for (const row of rows) {
    await db.execute(sql`
      UPDATE processing_queue SET
        attempts = attempts + 1,
        next_at = ${readyNow} + least(interval '6 hours', interval '30 seconds' * power(4, attempts)),
        last_error = ${error.slice(0, 500)}
      WHERE device_id = ${row.deviceId} AND from_at = ${row.from.toISOString()}::timestamptz
    `);
  }
}

/**
 * A processed window that still lacks map tiles waits for them: the tile
 * fetcher fetches what `missing_tiles` lists and makes the window ready again
 * once they are there; after a day it is processed again regardless. It waits
 * with the bounds it was queued with — never the ones a pass grew it to, or
 * the next pass would grow from those again, and a window queued for an
 * upload creep back across days of history.
 */
export async function awaitTiles(
  db: Executor,
  window: { deviceId: string; from: Date; to: Date; fromLevel: FromLevel; priority: number },
  missing: readonly TileKey[],
): Promise<void> {
  await db.execute(sql`
    INSERT INTO processing_queue (device_id, from_at, to_at, reason, from_level, priority, next_at, missing_tiles)
    VALUES (${window.deviceId}, ${window.from.toISOString()}::timestamptz, ${window.to.toISOString()}::timestamptz,
      'map', ${window.fromLevel === "inferred" ? "mapped" : window.fromLevel}, ${window.priority},
      ${readyNow} + interval '1 day', ${JSON.stringify(missing)}::jsonb)
    ON CONFLICT (device_id, from_at) DO UPDATE SET
      to_at = greatest(processing_queue.to_at, excluded.to_at),
      missing_tiles = excluded.missing_tiles,
      next_at = least(processing_queue.next_at, excluded.next_at),
      enqueued_at = now()
  `);
}

/**
 * Makes the windows ready whose missing tiles have all arrived, each fetched
 * at `staleBefore` or later (a window can wait for a refresh); returns how many.
 */
export async function rearmWindows(db: Executor, staleBefore: Date): Promise<number> {
  const result = await db.execute(sql`
    UPDATE processing_queue q SET next_at = ${readyNow}, missing_tiles = NULL
    WHERE q.missing_tiles IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(q.missing_tiles) AS m(key)
        WHERE NOT EXISTS (
          SELECT 1 FROM osm_tiles t
          WHERE t.z = split_part(m.key, '/', 1)::smallint
            AND t.x = split_part(m.key, '/', 2)::integer
            AND t.y = split_part(m.key, '/', 3)::integer
            AND t.status = 'ok'
            AND t.fetched_at >= ${staleBefore.toISOString()}::timestamptz
        )
      )
  `);
  return result.rowCount ?? 0;
}

/**
 * The tiles waiting windows need that are worth fetching now: not cached, or
 * cached before `staleBefore`, and not failing until later.
 */
export async function tilesToFetch(
  db: Executor,
  now: Date,
  staleBefore: Date,
  limit: number,
): Promise<TileKey[]> {
  const result = await db.execute<{ key: string }>(sql`
    SELECT m.key
    FROM processing_queue q
    CROSS JOIN LATERAL jsonb_array_elements_text(q.missing_tiles) WITH ORDINALITY AS m(key, position)
    LEFT JOIN osm_tiles t
      ON t.z = split_part(m.key, '/', 1)::smallint
      AND t.x = split_part(m.key, '/', 2)::integer
      AND t.y = split_part(m.key, '/', 3)::integer
    WHERE q.missing_tiles IS NOT NULL
      AND (t.z IS NULL OR (
        (t.status = 'failed' OR t.fetched_at < ${staleBefore.toISOString()}::timestamptz)
        AND (t.retry_at IS NULL OR t.retry_at <= ${now.toISOString()}::timestamptz)
      ))
    GROUP BY m.key
    ORDER BY min(q.priority), min(q.enqueued_at), min(m.position), m.key
    LIMIT ${limit}
  `);
  return result.rows.map((row) => row.key);
}

/** Whether recorded points in the range still wait for processing. */
export async function hasPendingWork(
  db: Executor,
  deviceIds: readonly string[],
  from: Date,
  to: Date,
): Promise<boolean> {
  if (deviceIds.length === 0) return false;
  const result = await db.execute<{ pending: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM processing_queue
      WHERE device_id = ANY(${sql.param(deviceIds)}::uuid[])
        AND from_at < ${to.toISOString()}::timestamptz AND to_at > ${from.toISOString()}::timestamptz
        AND missing_tiles IS NULL
    ) AS pending
  `);
  return result.rows[0]?.pending === true;
}
