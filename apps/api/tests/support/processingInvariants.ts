import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { Executor } from "../../src/db/database";
import { toIso } from "../../src/db/toIso";
import { queuePriority } from "../../src/processing/processingQueue";
import { processingVersions } from "../../src/processing/processingVersion";

/*
 * The invariants incremental processing keeps (docs/architecture.md §17.4,
 * design "processing as a service" §5.4), checked against the database after
 * a pass: I1 no overlap, I2 ends meet, I3 coverage, I4 no stale tails, I5 a
 * sane queue — and I6, a pass run again changes nothing.
 */

interface Range {
  from: Date;
  to: Date;
}

/** A recording gap the device travelled through: longer than this and its ends this far apart. */
const travelGap = { seconds: 1800, metres: 300 } as const;

const iso = (date: Date) => date.toISOString();

/** Metres between two positions given as SQL expressions (equirectangular: close ones only). */
const metres = (lat1: string, lon1: string, lat2: string, lon2: string) =>
  sql.raw(`111195 * sqrt(power(${lat2} - ${lat1}, 2)
    + power(cos(radians(${lat1})) * (${lon2} - ${lon1}), 2))`);

/** The consecutive segments of a device, each with the start of the one after it. */
const consecutive = (deviceId: string) => sql`
  SELECT kind, started_at, ended_at, end_lat, end_lon, features,
    lead(started_at) OVER w AS next_started, lead(start_lat) OVER w AS next_lat,
    lead(start_lon) OVER w AS next_lon
  FROM segments WHERE device_id = ${deviceId}
  WINDOW w AS (ORDER BY started_at)
`;

/** A hole between two consecutive segments the device travelled through (a travel gap). */
const isTravelGap = sql`(next_started - ended_at > ${travelGap.seconds}::integer * interval '1 second'
  AND ${metres("end_lat", "end_lon", "next_lat", "next_lon")} > ${travelGap.metres})`;

/**
 * I1–I4 for one device (within `range`, where given): no two segments
 * overlap; the next segment starts where one ends, but after a stop that
 * lasted beyond its last point and across a travel gap; every kept processed
 * point lies in one segment, or on the boundary two share; no segment of an
 * older inferred version overlaps a window a pass finished (`finished`), and
 * with `current` none is left at all.
 */
export async function assertSegmentInvariants(
  db: Executor,
  deviceId: string,
  options: { range?: Range; finished?: readonly Range[]; current?: boolean } = {},
): Promise<void> {
  const within = (column: string) =>
    options.range === undefined
      ? sql`true`
      : sql`${sql.raw(column)} >= ${iso(options.range.from)}::timestamptz
          AND ${sql.raw(column)} <= ${iso(options.range.to)}::timestamptz`;

  // I1: ordered by start, each segment ends before the next one starts (or where it starts).
  const overlaps = await db.execute(sql`
    SELECT started_at::text, ended_at::text, next_started::text FROM (${consecutive(deviceId)}) s
    WHERE (next_started < ended_at OR ended_at < started_at) AND ${within("started_at")}
    LIMIT 5
  `);
  expect(overlaps.rows, "I1: segments overlap").toEqual([]);

  // I2: the next segment starts at the end, but after a stop beyond its last point or a travel gap.
  const holes = await db.execute(sql`
    SELECT kind, started_at::text, ended_at::text, next_started::text FROM (${consecutive(deviceId)}) s
    WHERE next_started IS NOT NULL AND next_started <> ended_at
      AND NOT (kind = 'stop' AND (features->>'lastPointT')::float8 < extract(epoch FROM ended_at))
      AND NOT ${isTravelGap}
      AND ${within("ended_at")}
    LIMIT 5
  `);
  expect(holes.rows, "I2: segments that do not meet").toEqual([]);

  // I3: every kept point in a segment — on a boundary, the end of one and the start of the next.
  const uncovered = await db.execute(sql`
    SELECT p.recorded_at::text, count(s.started_at)::int AS segments
    FROM processed_points p
    LEFT JOIN segments s ON s.device_id = p.device_id
      AND s.started_at <= p.recorded_at AND s.ended_at >= p.recorded_at
    WHERE p.device_id = ${deviceId} AND p.kept AND ${within("p.recorded_at")}
    GROUP BY p.recorded_at
    HAVING count(s.started_at) = 0 OR count(s.started_at) > 2
      OR (count(s.started_at) = 2 AND count(*) FILTER (
        WHERE s.started_at = p.recorded_at OR s.ended_at = p.recorded_at) < 2)
    ORDER BY p.recorded_at
    LIMIT 5
  `);
  expect(uncovered.rows, "I3: kept points outside every segment, or in two").toEqual([]);

  // I4: what a pass finished at the current versions holds no segment of an older inference.
  for (const window of options.finished ?? []) {
    const stale = await db.execute(sql`
      SELECT started_at::text, ended_at::text, version FROM segments
      WHERE device_id = ${deviceId} AND version < ${processingVersions.inferred}
        AND started_at < ${iso(window.to)}::timestamptz AND ended_at > ${iso(window.from)}::timestamptz
      LIMIT 5
    `);
    expect(stale.rows, `I4: stale segments in ${iso(window.from)}…${iso(window.to)}`).toEqual([]);
  }
  if (options.current === true) {
    const old = await db.execute(sql`
      SELECT started_at::text, ended_at::text, version FROM segments
      WHERE device_id = ${deviceId} AND version < ${processingVersions.inferred}
      LIMIT 5
    `);
    expect(old.rows, "I4: segments of an older inference left").toEqual([]);
  }
}

/**
 * I5 for the queue (one device's rows, where given): ready times to the
 * millisecond (the worker's clock), known priorities, a window waiting for
 * map tiles not ready yet, and — given the ranges the device's uploads
 * queued (`uploads`) — every live window within the uploads it overlaps:
 * never grown earlier or later than they asked.
 */
export async function assertQueueInvariants(
  db: Executor,
  options: { deviceId?: string; uploads?: readonly Range[] } = {},
): Promise<void> {
  const device = options.deviceId === undefined ? sql`true` : sql`device_id = ${options.deviceId}`;
  const rows = await db.execute<{
    from_at: string;
    to_at: string;
    priority: number;
    reason: string;
    waiting: boolean;
    sub_millisecond: boolean;
    ready_while_waiting: boolean;
  }>(sql`
    SELECT from_at::text, to_at::text, priority, reason, missing_tiles IS NOT NULL AS waiting,
      extract(microseconds FROM next_at)::bigint % 1000 <> 0 AS sub_millisecond,
      (missing_tiles IS NOT NULL AND next_at <= now()) AS ready_while_waiting
    FROM processing_queue WHERE ${device}
    ORDER BY device_id, from_at
  `);
  const priorities: readonly number[] = Object.values(queuePriority);
  for (const row of rows.rows) {
    const label = `I5: ${row.reason} window ${row.from_at}…${row.to_at}`;
    expect(row.sub_millisecond, `${label}: ready time beyond the millisecond`).toBe(false);
    expect(priorities, `${label}: priority`).toContain(row.priority);
    expect(row.ready_while_waiting, `${label}: ready while it waits for tiles`).toBe(false);
  }
  if (options.uploads === undefined) return;
  for (const row of rows.rows.filter((entry) => entry.priority === queuePriority.live)) {
    const from = Date.parse(toIso(row.from_at));
    const to = Date.parse(toIso(row.to_at));
    const asked = options.uploads.filter(
      (upload) => upload.from.getTime() < to && upload.to.getTime() > from,
    );
    const label = `I5: live window ${row.from_at}…${row.to_at}`;
    expect(asked.length, `${label}: no upload queued it`).toBeGreaterThan(0);
    expect(from, `${label}: earlier than queued`).toBeGreaterThanOrEqual(
      Math.min(...asked.map((upload) => upload.from.getTime())),
    );
    expect(to, `${label}: later than queued`).toBeLessThanOrEqual(
      Math.max(...asked.map((upload) => upload.to.getTime())),
    );
  }
}

/** What a device's derived rows hold, without the times they were written. */
export async function processingFingerprint(
  db: Executor,
  deviceId: string,
  range: Range,
): Promise<unknown> {
  const segments = await db.execute(sql`
    SELECT id, started_at::text, ended_at::text, kind, mode, mode_inferred, mode_user, confidence,
      review, distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
      centroid_lat, centroid_lon, features, version
    FROM segments
    WHERE device_id = ${deviceId}
      AND started_at <= ${iso(range.to)}::timestamptz AND ended_at >= ${iso(range.from)}::timestamptz
    ORDER BY started_at
  `);
  const points = await db.execute(sql`
    SELECT recorded_at::text, kept, lat_avg, lon_avg, speed_avg, lat_map, lon_map, way_id::text,
      way_kind, snap_m, path_map, version
    FROM processed_points
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${iso(range.from)}::timestamptz AND recorded_at <= ${iso(range.to)}::timestamptz
    ORDER BY recorded_at
  `);
  return { segments: segments.rows, points: points.rows };
}

/** I6: running a finished pass again (`again`) changes none of the device's derived rows in `range`. */
export async function assertIdempotent(
  db: Executor,
  deviceId: string,
  range: Range,
  again: () => Promise<unknown>,
): Promise<void> {
  const before = await processingFingerprint(db, deviceId, range);
  await again();
  expect(
    await processingFingerprint(db, deviceId, range),
    "I6: a pass run again changed rows",
  ).toEqual(before);
}
