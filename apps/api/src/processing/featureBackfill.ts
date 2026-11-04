import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import type { Database, Executor } from "../db/database";
import { type ProcessingFeature, processingFeatureVersions } from "./processingVersion";

/** The days a move's metres per way are counted over: one device and one UTC day per statement. */
const dayMs = 86_400_000;

/**
 * Fills `features.wayTotals` of the moves that lack it, `device`'s from `[fromMs, toMs)` by start,
 * from the stored processed points (docs/architecture.md §17.4): the kept points of the move, the
 * distance between consecutive ones (their mapped position, else the averaged one; haversine),
 * half of each step to each end point's way, ways of 25 m or more, longest first, at most 64 — the
 * rules of `extractFeatures`, in SQL. A move with map data (`wayKinds`) gets the array, any other
 * `null`, as the pipeline writes them. Nothing else of the segment changes: not `version`, not
 * `computed_at`. Returns the moves filled.
 */
async function fillWayTotals(
  db: Executor,
  deviceId: string,
  fromMs: number,
  toMs: number,
): Promise<number> {
  const result = await db.execute(sql`
    WITH moves AS (
      SELECT s.id, s.device_id, s.started_at, s.ended_at,
        jsonb_typeof(s.features->'wayKinds') = 'object' AS mapped
      FROM segments s
      WHERE s.device_id = ${deviceId}::uuid AND s.kind = 'move'
        AND s.started_at >= ${new Date(fromMs).toISOString()}::timestamptz
        AND s.started_at < ${new Date(toMs).toISOString()}::timestamptz
        AND NOT s.features ? 'wayTotals'
    ),
    points AS (
      SELECT m.id, p.recorded_at, p.way_id,
        radians(coalesce(p.lat_map, p.lat_avg)) AS lat, radians(coalesce(p.lon_map, p.lon_avg)) AS lon
      FROM moves m
      JOIN processed_points p ON p.device_id = m.device_id AND p.kept
        AND p.recorded_at >= m.started_at AND p.recorded_at <= m.ended_at
      WHERE m.mapped
    ),
    steps AS (
      SELECT id, way_id, prev_way,
        CASE WHEN prev_lat IS NULL THEN NULL ELSE
          2 * 6371000 * asin(sqrt(least(1, power(sin((lat - prev_lat) / 2), 2)
            + cos(lat) * cos(prev_lat) * power(sin((lon - prev_lon) / 2), 2)))) END AS metres
      FROM (
        SELECT id, way_id, lat, lon, lag(way_id) OVER w AS prev_way,
          lag(lat) OVER w AS prev_lat, lag(lon) OVER w AS prev_lon
        FROM points
        WINDOW w AS (PARTITION BY id ORDER BY recorded_at)
      ) ordered
    ),
    halves AS (
      SELECT id, way_id AS way, metres / 2 AS m FROM steps WHERE way_id IS NOT NULL AND metres IS NOT NULL
      UNION ALL
      SELECT id, prev_way, metres / 2 FROM steps WHERE prev_way IS NOT NULL AND metres IS NOT NULL
    ),
    totals AS (
      SELECT id, way, sum(m) AS metres FROM halves GROUP BY id, way HAVING sum(m) >= 25
    ),
    ranked AS (
      SELECT id, way, metres,
        row_number() OVER (PARTITION BY id ORDER BY metres DESC, way) AS rank
      FROM totals
    ),
    packed AS (
      SELECT id, jsonb_agg(jsonb_build_array(way, round(metres::numeric, 1)) ORDER BY metres DESC, way) AS totals
      FROM ranked WHERE rank <= 64 GROUP BY id
    )
    UPDATE segments s
    SET features = s.features || jsonb_build_object('wayTotals',
      CASE WHEN m.mapped THEN coalesce(k.totals, '[]'::jsonb) ELSE 'null'::jsonb END)
    FROM moves m LEFT JOIN packed k ON k.id = m.id
    WHERE s.id = m.id
  `);
  return result.rowCount ?? 0;
}

/** The start of the newest move of `deviceId` before `beforeMs` that lacks the feature, or null. */
async function newestLacking(
  db: Executor,
  deviceId: string,
  beforeMs: number | null,
): Promise<number | null> {
  const result = await db.execute<{ at: number }>(sql`
    SELECT (extract(epoch FROM started_at) * 1000)::float8 AS at
    FROM segments
    WHERE device_id = ${deviceId}::uuid AND kind = 'move' AND NOT features ? 'wayTotals'
      ${beforeMs === null ? sql`` : sql`AND started_at < ${new Date(beforeMs).toISOString()}::timestamptz`}
    ORDER BY started_at DESC
    LIMIT 1
  `);
  return result.rows[0]?.at ?? null;
}

/** The devices with a move that lacks the feature (one index probe per device). */
async function devicesLacking(db: Executor): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT d.id FROM devices d
    WHERE EXISTS (
      SELECT 1 FROM segments s
      WHERE s.device_id = d.id AND s.kind = 'move' AND NOT s.features ? 'wayTotals'
    )
  `);
  return result.rows.map((row) => row.id);
}

/** What a feature's fill does for one device-day. */
const fills: Readonly<
  Record<
    ProcessingFeature,
    (db: Executor, deviceId: string, fromMs: number, toMs: number) => Promise<number>
  >
> = { wayTotals: fillWayTotals };

interface StateRow extends Record<string, unknown> {
  value: { versions?: Partial<Record<ProcessingFeature, number>> } | null;
}

/** The features whose recorded version is not the current one. */
async function featuresToFill(db: Executor): Promise<ProcessingFeature[]> {
  const state = await db.execute<StateRow>(sql`
    SELECT value FROM processing_state WHERE key = 'features'
  `);
  const recorded = state.rows[0]?.value?.versions ?? {};
  return (Object.keys(processingFeatureVersions) as ProcessingFeature[]).filter(
    (feature) => recorded[feature] !== processingFeatureVersions[feature],
  );
}

/** Records that `feature` is filled in, at the current version, keeping the others'. */
async function recordFilled(db: Executor, feature: ProcessingFeature): Promise<void> {
  await db.execute(sql`
    INSERT INTO processing_state (key, value, updated_at)
    VALUES ('features', jsonb_build_object('versions',
      jsonb_build_object(${feature}::text, ${processingFeatureVersions[feature]}::int)), now())
    ON CONFLICT (key) DO UPDATE SET
      value = jsonb_set(processing_state.value, ARRAY['versions', ${feature}::text],
        to_jsonb(${processingFeatureVersions[feature]}::int), true),
      updated_at = now()
  `);
}

export interface FeatureBackfillRun {
  features: ProcessingFeature[];
  moves: number;
  days: number;
  /** False when stopped before every device was done: it resumes at the next start. */
  complete: boolean;
}

/**
 * The start-up fill of features of the stored segments (docs/architecture.md §17.4), the cheap
 * counterpart of the level backfill: for each feature whose recorded version is old, every device's
 * moves that lack it are filled one device-day at a time, newest first, from rows already derived
 * (SQL only: no points loaded, no map data, no matching, no change to the segments' versions or
 * stamps). Progress is in the segments themselves, so an interrupted run resumes by finding the
 * rest; the version is recorded when none is left, so it runs once. Between days it gives way:
 * `busy` (a processing pass is at work) holds it off, and it pauses `pauseMs`.
 */
export async function runFeatureBackfill(
  db: Database,
  options: {
    signal?: AbortSignal;
    busy?: () => boolean;
    pauseMs?: number;
    onDay?: (day: { deviceId: string; moves: number }) => void;
  } = {},
): Promise<FeatureBackfillRun> {
  const pauseMs = options.pauseMs ?? 25;
  const features = await featuresToFill(db);
  const run: FeatureBackfillRun = { features, moves: 0, days: 0, complete: true };
  const stopped = () => options.signal?.aborted === true;
  for (const feature of features) {
    for (const deviceId of await devicesLacking(db)) {
      let before: number | null = null;
      for (;;) {
        if (stopped()) return { ...run, complete: false };
        while (options.busy?.() === true && !stopped()) await sleep(1000).catch(() => undefined);
        const next = await newestLacking(db, deviceId, before);
        if (next === null) break;
        const dayStart = Math.floor(next / dayMs) * dayMs;
        const moves = await fills[feature](db, deviceId, dayStart, dayStart + dayMs);
        run.moves += moves;
        run.days += 1;
        options.onDay?.({ deviceId, moves });
        before = dayStart;
        if (pauseMs > 0) await sleep(pauseMs).catch(() => undefined);
      }
    }
    if (stopped()) return { ...run, complete: false };
    await recordFilled(db, feature);
  }
  return run;
}
