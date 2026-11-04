import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import type { Database, Executor } from "../db/database";
import { keptPointInDay } from "../heatmap/heatDaysValidator";
import { rebuildHeatDays } from "../heatmap/rebuildHeatDays";
import { lockDeviceProcessing } from "./deviceLock";
import { type ProcessingFeature, processingFeatureVersions } from "./processingVersion";

/** The days a move's metres per way are counted over: one device and one UTC day per statement. */
const dayMs = 86_400_000;

/** The great-circle distance in metres between two points given as SQL expressions in radians. */
const haversine = (lat1: string, lon1: string, lat2: string, lon2: string): string =>
  `2 * 6371008.8 * asin(sqrt(least(1, power(sin((${lat2} - ${lat1}) / 2), 2) + cos(${lat1}) * cos(${lat2}) * power(sin((${lon2} - ${lon1}) / 2), 2))))`;

/**
 * Fills `features.wayTotals` of the moves that lack it, `device`'s from `[fromMs, toMs)` by start,
 * from the stored processed points (docs/architecture.md §17.4), as the pipeline counts them
 * (`moveSeries`, `extractFeatures`): each interval between consecutive kept points is measured
 * along the way's shape (`path_map`'s vertices) when both ends are mapped, else as the chord
 * between the averaged points; half of it goes to each end point's way; ways of 25 m or more,
 * longest first, at most 64, to 0.1 m. A move with map data (`wayKinds`) gets the array, any other
 * `null`, as the pipeline writes them. Nothing else of the segment changes: not `version`, not
 * `computed_at`. A move that has the key by the time the update runs (a pass wrote it) is left as
 * it is. The caller holds the device's processing lock. Returns the moves filled.
 */
async function fillWayTotals(
  db: Executor,
  deviceId: string,
  fromMs: number,
  toMs: number,
): Promise<number> {
  const along = sql.raw(`(
    SELECT coalesce(sum(${haversine("v.prev_lat", "v.prev_lon", "v.lat", "v.lon")}), 0)
    FROM (
      SELECT lat, lon, lag(lat) OVER (ORDER BY ord) AS prev_lat, lag(lon) OVER (ORDER BY ord) AS prev_lon
      FROM (
        SELECT 0 AS ord, o.map_lat AS lat, o.map_lon AS lon
        UNION ALL
        SELECT e.ord::int, radians((e.vertex->>1)::float8), radians((e.vertex->>0)::float8)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.path_map) = 'array' THEN o.path_map ELSE '[]'::jsonb END)
          WITH ORDINALITY AS e(vertex, ord)
        UNION ALL
        SELECT 1000000, o.cur_map_lat, o.cur_map_lon
      ) vertices
    ) v
    WHERE v.prev_lat IS NOT NULL
  )`);
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
      SELECT m.id, p.recorded_at, p.way_id, radians(p.lat_avg) AS lat, radians(p.lon_avg) AS lon,
        radians(p.lat_map) AS map_lat, radians(p.lon_map) AS map_lon, p.path_map
      FROM moves m
      JOIN processed_points p ON p.device_id = m.device_id AND p.kept
        AND p.recorded_at >= m.started_at AND p.recorded_at <= m.ended_at
      WHERE m.mapped
    ),
    ordered AS (
      SELECT id, way_id, lat, lon, map_lat AS cur_map_lat, map_lon AS cur_map_lon, path_map,
        lag(way_id) OVER w AS prev_way, lag(lat) OVER w AS prev_lat, lag(lon) OVER w AS prev_lon,
        lag(map_lat) OVER w AS map_lat, lag(map_lon) OVER w AS map_lon
      FROM points
      WINDOW w AS (PARTITION BY id ORDER BY recorded_at)
    ),
    steps AS (
      SELECT o.id, o.way_id, o.prev_way,
        CASE WHEN o.prev_lat IS NULL THEN NULL
          WHEN o.map_lat IS NOT NULL AND o.map_lon IS NOT NULL
            AND o.cur_map_lat IS NOT NULL AND o.cur_map_lon IS NOT NULL THEN ${along}
          ELSE ${sql.raw(haversine("o.prev_lat", "o.prev_lon", "o.lat", "o.lon"))} END AS metres
      FROM ordered o
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
    WHERE s.id = m.id AND NOT s.features ? 'wayTotals'
  `);
  return result.rowCount ?? 0;
}

/**
 * What a feature's fill works on: units of one device (a UTC day of moves, a local day of heat
 * cells) newest first, `Cursor` marking where one begins. `next` finds the newest unit before
 * `before` that still lacks the feature — the partial index or the missing rows list them — and
 * `fill` makes it, in the caller's transaction (under the device's processing lock).
 */
interface FeatureFill<Cursor> {
  devicesLacking(db: Executor): Promise<string[]>;
  next(db: Executor, deviceId: string, before: Cursor | null): Promise<Cursor | null>;
  fill(tx: Executor, deviceId: string, at: Cursor): Promise<number>;
}

const wayTotalsFill: FeatureFill<number> = {
  // The devices with a move that lacks the totals (the partial index `segments_move_lacking_totals_idx`).
  async devicesLacking(db) {
    const result = await db.execute<{ id: string }>(sql`
      SELECT d.id FROM devices d
      WHERE EXISTS (
        SELECT 1 FROM segments s
        WHERE s.device_id = d.id AND s.kind = 'move' AND NOT s.features ? 'wayTotals'
      )
    `);
    return result.rows.map((row) => row.id);
  },
  // The start (epoch ms) of the UTC day of the newest move before `before` that lacks them.
  async next(db, deviceId, before) {
    const result = await db.execute<{ at: number }>(sql`
      SELECT (extract(epoch FROM started_at) * 1000)::float8 AS at
      FROM segments
      WHERE device_id = ${deviceId}::uuid AND kind = 'move' AND NOT features ? 'wayTotals'
        ${before === null ? sql`` : sql`AND started_at < ${new Date(before).toISOString()}::timestamptz`}
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const at = result.rows[0]?.at;
    return at === undefined ? null : Math.floor(at / dayMs) * dayMs;
  },
  fill: (tx, deviceId, dayStart) => fillWayTotals(tx, deviceId, dayStart, dayStart + dayMs),
};

/**
 * Local days of a device with points (the daily statistics have them, in the owner's zone, which
 * `heat_days` is cut in too) that have no row in `heat_days`: the per-day heat cells of history
 * from before they existed (docs/architecture.md §5).
 */
const heatDaysFill: FeatureFill<string> = {
  async devicesLacking(db) {
    const result = await db.execute<{ id: string }>(sql`
      SELECT d.id FROM devices d JOIN users u ON u.id = d.user_id
      WHERE EXISTS (
        SELECT 1 FROM daily_stats s
        WHERE s.device_id = d.id AND s.points > 0
          AND ${keptPointInDay(sql`s`, sql`u.timezone`)}
          AND NOT EXISTS (SELECT 1 FROM heat_days h WHERE h.device_id = s.device_id AND h.day = s.date)
      )
    `);
    return result.rows.map((row) => row.id);
  },
  async next(db, deviceId, before) {
    const result = await db.execute<{ day: string }>(sql`
      SELECT s.date::text AS day FROM daily_stats s
      JOIN devices d ON d.id = s.device_id JOIN users u ON u.id = d.user_id
      WHERE s.device_id = ${deviceId}::uuid AND s.points > 0
        AND ${keptPointInDay(sql`s`, sql`u.timezone`)}
        ${before === null ? sql`` : sql`AND s.date < ${before}::date`}
        AND NOT EXISTS (SELECT 1 FROM heat_days h WHERE h.device_id = s.device_id AND h.day = s.date)
      ORDER BY s.date DESC
      LIMIT 1
    `);
    return result.rows[0]?.day ?? null;
  },
  async fill(tx, deviceId, day) {
    const owner = await tx.execute<{ timezone: string }>(sql`
      SELECT u.timezone FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = ${deviceId}::uuid
    `);
    const timezone = owner.rows[0]?.timezone;
    return timezone === undefined ? 0 : rebuildHeatDays(tx, deviceId, timezone, [day]);
  },
};

// Each feature with the cursor of its own kind.
const fills: { [F in ProcessingFeature]: FeatureFill<never> } = {
  wayTotals: wayTotalsFill as FeatureFill<never>,
  heatDays: heatDaysFill as FeatureFill<never>,
};

interface StateRow extends Record<string, unknown> {
  value: { versions?: Partial<Record<ProcessingFeature, number>> } | null;
}

/**
 * The features to fill: those whose recorded version is not the current one, and — whatever the
 * marker says — those with a unit that still lacks them (one a lost race or an older process left
 * behind), so that nothing stays `pending` for good.
 */
async function featuresToFill(db: Executor): Promise<ProcessingFeature[]> {
  const state = await db.execute<StateRow>(sql`
    SELECT value FROM processing_state WHERE key = 'features'
  `);
  const recorded = state.rows[0]?.value?.versions ?? {};
  const wanted: ProcessingFeature[] = [];
  for (const feature of Object.keys(processingFeatureVersions) as ProcessingFeature[]) {
    if (
      recorded[feature] !== processingFeatureVersions[feature] ||
      (await fills[feature].devicesLacking(db)).length > 0
    ) {
      wanted.push(feature);
    }
  }
  return wanted;
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
  /** Another process holds the fill: this one left it to it. */
  skipped?: true;
}

/**
 * The start-up fill of features of the stored segments (docs/architecture.md §17.4), the cheap
 * counterpart of the level backfill: for each feature to fill, every device's moves that lack it
 * are filled one device-day at a time, newest first, from rows already derived (SQL only: no points
 * loaded, no map data, no matching, no change to the segments' versions or stamps). Each day is a
 * transaction under the device's processing lock, so a live pass never overlaps it, and under an
 * advisory lock for the fill itself, so that one process fills at a time: another that finds it
 * taken leaves the rest to it. Progress is in the segments themselves (a partial index lists the
 * moves still lacking), so an interrupted run resumes by finding what is left, and so does every
 * start; the version is recorded when none is left. Between days it gives way: `busy` (a pass of
 * this process is at work) holds it off, and it pauses `pauseMs`.
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
    const unit = fills[feature] as FeatureFill<unknown>;
    for (const deviceId of await unit.devicesLacking(db)) {
      let before: unknown = null;
      for (;;) {
        if (stopped()) return { ...run, complete: false };
        while (options.busy?.() === true && !stopped()) await sleep(1000).catch(() => undefined);
        const next = await unit.next(db, deviceId, before);
        if (next === null) break;
        const moves = await db.transaction(async (tx) => {
          const lock = await tx.execute<{ taken: boolean }>(
            sql`SELECT pg_try_advisory_xact_lock(hashtextextended('trail.feature-backfill', 0)) AS taken`,
          );
          if (lock.rows[0]?.taken !== true) return null;
          await lockDeviceProcessing(tx, deviceId);
          return unit.fill(tx, deviceId, next);
        });
        if (moves === null) return { ...run, complete: false, skipped: true };
        run.moves += moves;
        run.days += 1;
        options.onDay?.({ deviceId, moves });
        before = next;
        if (pauseMs > 0) await sleep(pauseMs).catch(() => undefined);
      }
    }
    if (stopped()) return { ...run, complete: false };
    await recordFilled(db, feature);
  }
  return run;
}
