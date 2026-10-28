import type { ChosenMode } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type {
  ManualTrip,
  MappedPoint,
  OverrideSpan,
  RawPoint,
  StayBefore,
  VisitSpan,
} from "./pipelineTypes";
import { continuesBeforeSql, stayStartedAfterSql } from "./stayParts";
import { endsToggleSql } from "./travelFamily";

/** Rows per round trip when reading a window's points. */
const pageSize = 20_000;
/** How far a window grows to take in the segments at its edges, at most. */
export const maxExtensionMs = 2 * 86_400_000;
/**
 * The points of its budget a window keeps for the steps across its seams —
 * back to the point before a recording gap, forward to the first point of a
 * segment after a short hole — which it takes even when nothing else fits.
 */
export const seamPoints = 2;

const epoch = (value: string): number => Math.round(Date.parse(toIso(value)) / 1000);

const instant = (value: string): Date => new Date(toIso(value));

/** The first recorded point at `from` or later (and at `to` or earlier), if any. */
async function firstPointFrom(db: Executor, deviceId: string, from: Date, to: Date) {
  const result = await db.execute<{ at: string | null }>(sql`
    SELECT min(recorded_at)::text AS at FROM locations
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${from.toISOString()}::timestamptz AND recorded_at <= ${to.toISOString()}::timestamptz
  `);
  const at = result.rows[0]?.at ?? null;
  return at === null ? null : instant(at);
}

/** The last recorded point at `to` or earlier (and at `from` or later), if any. */
async function lastPointUntil(db: Executor, deviceId: string, from: Date, to: Date) {
  const result = await db.execute<{ at: string | null }>(sql`
    SELECT max(recorded_at)::text AS at FROM locations
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${from.toISOString()}::timestamptz AND recorded_at <= ${to.toISOString()}::timestamptz
  `);
  const at = result.rows[0]?.at ?? null;
  return at === null ? null : instant(at);
}

/**
 * The window grown to whole segments (docs/architecture.md §17.4): the stop or
 * move under each edge — and one that just touches it — is processed again as
 * a whole, at most two days out (a segment reaching further back is cut at the
 * window's start when the results are stored). When no segment meets the
 * window's start and a recording gap longer than `gapSplitS` lies before its
 * first point — the night the phone slept through — it reaches back to the
 * segment before the gap (or, with none yet, to the point before it), so that
 * the gap is worked out with both its ends: a gap the phone lay still through
 * is a stop, a visit's stop lasts until its departure. A shorter hole is no
 * such gap: the window starts where it did. At its end, though, a segment
 * that starts after a short hole with no point in it (a day's edge between
 * two points, as an older pass left it) touches the window like one sharing
 * its edge, so the window that comes before the hole works the seam out.
 *
 * Within the budget of a pass: the growth is taken while the window holds at
 * most `maxPoints` points — forward first (the segment the window's end runs
 * into), then back, nearest first (the segment under the start, then the one
 * before a gap, else the point before it) — each whole or not at all, so the
 * window is not cut again at another place with every upload. A segment that
 * does not fit stays as it is, cut where the queued range starts or ends:
 * at a point, so that its part and the window meet, and its part counts its
 * own and keeps its mode (`persistWindow`). Two steps are taken even when
 * nothing else fits, with points the budget keeps for them (`seamPoints`): back
 * to the point before a recording gap in front of the first point, so the gap
 * is worked out with both its ends, and forward to the first point of a
 * segment after a short hole, so the two meet. A stale multi-day stop at an
 * edge thus costs a pass at most the budget, never two days of it.
 */
export async function extendWindow(
  db: Executor,
  deviceId: string,
  window: { from: Date; to: Date },
  options: { gapSplitS: number; maxPoints: number },
): Promise<{ from: Date; to: Date }> {
  const { from, to } = window;
  const { gapSplitS } = options;
  const result = await db.execute<{ first: string | null; last: string | null }>(sql`
    SELECT min(started_at)::text AS first, max(ended_at)::text AS last
    FROM segments
    WHERE device_id = ${deviceId}
      AND started_at <= ${to.toISOString()}::timestamptz
      AND ended_at >= ${from.toISOString()}::timestamptz
  `);
  const row = result.rows[0];
  // The segments under the edges, or that just touch them, where they reach beyond the range.
  const first = row?.first === null || row?.first === undefined ? from : instant(row.first);
  const last = row?.last === null || row?.last === undefined ? to : instant(row.last);
  const underFrom = first < from ? first : null;
  const underTo = last > to ? last : null;
  // Back, outermost first: the segment before a gap, the point before it, the segment under the start.
  const back: Date[] = [];
  let pointBeforeGap: Date | null = null;
  const start = underFrom ?? from;
  const before = await db.execute<{ started_at: string; ended_at: string }>(sql`
    SELECT started_at::text, ended_at::text FROM segments
    WHERE device_id = ${deviceId} AND ended_at <= ${start.toISOString()}::timestamptz
    ORDER BY ended_at DESC
    LIMIT 1
  `);
  const previous = before.rows[0];
  // A segment ending where the window starts meets it; one ending earlier leaves a hole.
  const meets = previous !== undefined && Date.parse(toIso(previous.ended_at)) >= start.getTime();
  if (!meets) {
    const edges = await db.execute<{ before: string | null; after: string | null }>(sql`
      SELECT
        (SELECT recorded_at::text FROM locations
          WHERE device_id = ${deviceId} AND recorded_at < ${start.toISOString()}::timestamptz
          ORDER BY recorded_at DESC LIMIT 1) AS before,
        (SELECT recorded_at::text FROM locations
          WHERE device_id = ${deviceId} AND recorded_at >= ${start.toISOString()}::timestamptz
          ORDER BY recorded_at LIMIT 1) AS after
    `);
    const edge = edges.rows[0];
    // Where the hole begins: the end of the segment before it, else the point before it.
    const holeFrom =
      previous !== undefined
        ? Date.parse(toIso(previous.ended_at))
        : edge?.before === null || edge?.before === undefined
          ? null
          : Date.parse(toIso(edge.before));
    const holeTo =
      edge?.after === null || edge?.after === undefined ? null : Date.parse(toIso(edge.after));
    if (holeFrom !== null && holeTo !== null && holeTo - holeFrom > gapSplitS * 1000) {
      if (previous !== undefined) back.push(instant(previous.started_at));
      if (edge?.before !== null && edge?.before !== undefined) {
        pointBeforeGap = instant(edge.before);
        back.push(pointBeforeGap);
      }
    }
  }
  if (underFrom !== null) back.push(underFrom);

  // Two days out at most, cut at a point.
  const capFrom = new Date(from.getTime() - maxExtensionMs);
  const capTo = new Date(to.getTime() + maxExtensionMs);
  const backAtCap = back.some((at) => at < capFrom)
    ? await firstPointFrom(db, deviceId, capFrom, from)
    : null;
  const backward = [
    ...new Set(
      back
        .map((at) => (at >= capFrom ? at : backAtCap))
        .filter((at): at is Date => at !== null && at < from)
        .map((at) => at.getTime()),
    ),
  ].map((ms) => new Date(ms));
  // Forward: the segment under the end, else one beyond a short hole without a point in it.
  const touching = underTo === null ? await nextTouching(db, deviceId, to, gapSplitS) : null;
  const reaching = underTo ?? touching?.endedAt ?? null;
  const forward =
    reaching === null
      ? null
      : reaching <= capTo
        ? reaching
        : await lastPointUntil(db, deviceId, to, capTo).then((at) =>
            at !== null && at > to ? at : null,
          );

  // The points of the queued range, of the growth forward and of each step back: one scan.
  const lowest = new Date(Math.min(from.getTime(), ...backward.map((at) => at.getTime())));
  const highest = forward ?? to;
  const counts = await db.execute<Record<string, number | string | null>>(sql`
    SELECT
      count(*) FILTER (WHERE recorded_at >= ${from.toISOString()}::timestamptz
        AND recorded_at <= ${to.toISOString()}::timestamptz)::int AS queued,
      count(*) FILTER (WHERE recorded_at > ${to.toISOString()}::timestamptz)::int AS forward,
      min(recorded_at) FILTER (WHERE recorded_at >= ${from.toISOString()}::timestamptz
        AND recorded_at <= ${to.toISOString()}::timestamptz)::text AS first_queued,
      max(recorded_at) FILTER (WHERE recorded_at >= ${from.toISOString()}::timestamptz
        AND recorded_at <= ${to.toISOString()}::timestamptz)::text AS last_queued,
      max(recorded_at) FILTER (WHERE recorded_at < ${from.toISOString()}::timestamptz)::text
        AS before_queued
      ${sql.join(
        backward.map(
          (at, index) =>
            sql`, count(*) FILTER (WHERE recorded_at >= ${at.toISOString()}::timestamptz
              AND recorded_at < ${from.toISOString()}::timestamptz)::int AS ${sql.raw(`back_${index}`)}`,
        ),
      )}
    FROM locations
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${lowest.toISOString()}::timestamptz
      AND recorded_at <= ${highest.toISOString()}::timestamptz
  `);
  const tally = counts.rows[0] ?? {};
  const countOf = (key: string) => Number(tally[key] ?? 0);
  const pointOf = (key: string) => {
    const value = tally[key];
    return typeof value === "string" ? instant(value) : null;
  };
  let room = options.maxPoints - seamPoints - countOf("queued");
  let end = underTo === null ? to : (pointOf("last_queued") ?? to);
  if (forward !== null && countOf("forward") <= room) {
    room -= countOf("forward");
    end = forward;
  } else if (touching !== null) {
    // The segment after the hole does not fit: a step to its first point, where the two meet.
    end = touching.startedAt;
  }
  const reached = backward.findIndex((_, index) => countOf(`back_${index}`) <= room);
  if (reached >= 0) return { from: backward[reached] ?? from, to: end };
  if (underFrom === null) {
    // Nothing before fits: a step back across a recording gap to the point before it, all the same.
    const step = pointBeforeGap !== null && pointBeforeGap >= capFrom ? pointBeforeGap : null;
    return { from: step ?? from, to: end };
  }
  // Cut at the queued range's first point — or at the one before it, across a recording gap.
  const firstQueued = pointOf("first_queued");
  const beforeQueued = pointOf("before_queued");
  const acrossGap =
    firstQueued !== null &&
    beforeQueued !== null &&
    firstQueued.getTime() - beforeQueued.getTime() > gapSplitS * 1000;
  return { from: acrossGap ? beforeQueued : (firstQueued ?? from), to: end };
}

/**
 * The segment that starts after `to` with no recorded point between — after a
 * hole of at most `gapSplitS` from the last point before `to` — if there is
 * one: it touches a window ending at `to`.
 */
async function nextTouching(
  db: Executor,
  deviceId: string,
  to: Date,
  gapSplitS: number,
): Promise<{ startedAt: Date; endedAt: Date } | null> {
  const result = await db.execute<{ started_at: string; ended_at: string }>(sql`
    SELECT s.started_at::text, s.ended_at::text FROM (
      SELECT started_at, ended_at FROM segments
      WHERE device_id = ${deviceId} AND started_at > ${to.toISOString()}::timestamptz
      ORDER BY started_at LIMIT 1
    ) s
    WHERE NOT EXISTS (
        SELECT 1 FROM locations
        WHERE device_id = ${deviceId} AND recorded_at > ${to.toISOString()}::timestamptz
          AND recorded_at < s.started_at)
      AND s.started_at - ${gapSplitS}::integer * interval '1 second' <= (
        SELECT max(recorded_at) FROM locations
        WHERE device_id = ${deviceId} AND recorded_at <= ${to.toISOString()}::timestamptz)
  `);
  const row = result.rows[0];
  return row === undefined
    ? null
    : { startedAt: instant(row.started_at), endedAt: instant(row.ended_at) };
}

interface PointRow extends Record<string, unknown> {
  recorded_at: string;
  lat: number;
  lon: number;
  horizontal_accuracy: number | null;
  speed: number | null;
  altitude: number | null;
  vertical_accuracy: number | null;
  motion: string[];
}

/** The recorded points of `[from, to]`, oldest first. */
export async function loadRawPoints(
  db: Executor,
  deviceId: string,
  from: Date,
  to: Date,
): Promise<RawPoint[]> {
  const points: RawPoint[] = [];
  let after: string | null = null;
  for (;;) {
    const page: { rows: PointRow[] } = await db.execute<PointRow>(sql`
      SELECT recorded_at::text, lat, lon, horizontal_accuracy, speed, altitude, vertical_accuracy, motion
      FROM locations
      WHERE device_id = ${deviceId}
        AND recorded_at ${after === null ? sql`>=` : sql`>`} ${after ?? from.toISOString()}::timestamptz
        AND recorded_at <= ${to.toISOString()}::timestamptz
      ORDER BY recorded_at
      LIMIT ${pageSize}
    `);
    for (const row of page.rows) {
      points.push({
        t: epoch(row.recorded_at),
        lat: row.lat,
        lon: row.lon,
        accuracy: row.horizontal_accuracy,
        speed: row.speed,
        altitude: row.altitude,
        verticalAccuracy: row.vertical_accuracy,
        motion: row.motion,
      });
    }
    const last = page.rows.at(-1);
    if (last === undefined || page.rows.length < pageSize) break;
    after = toIso(last.recorded_at);
  }
  return points;
}

/**
 * The iOS visits overlapping the window. iOS reports a visit twice — on
 * arrival (no departure yet) and again on departure, with the same arrival —
 * and both rows are kept as recorded, so they are merged first, per arrival:
 * a report with a departure supersedes the arrival alone, the latest report
 * wins among several. Only then is a visit that departed before the window
 * left out: the arrival alone must not pass for a visit still open. A visit
 * whose departure never came was over by the next visit's arrival
 * (`endsBy`): one over before the window is left out too.
 */
export async function loadVisits(
  db: Executor,
  deviceId: string,
  from: Date,
  to: Date,
): Promise<VisitSpan[]> {
  const result = await db.execute<{
    arrived_at: string;
    departed_at: string | null;
    next_arrival: string | null;
    lat: number;
    lon: number;
    horizontal_accuracy: number | null;
  }>(sql`
    SELECT arrived_at::text, departed_at::text, next_arrival::text, lat, lon, horizontal_accuracy
    FROM (
      SELECT merged.*, lead(arrived_at) OVER (ORDER BY arrived_at) AS next_arrival
      FROM (
        SELECT DISTINCT ON (arrived_at) arrived_at, departed_at, lat, lon, horizontal_accuracy
        FROM visits
        WHERE device_id = ${deviceId} AND arrived_at IS NOT NULL
        ORDER BY arrived_at, (departed_at IS NULL), recorded_at DESC
      ) merged
    ) visit
    WHERE arrived_at <= ${to.toISOString()}::timestamptz
      AND coalesce(departed_at, next_arrival, 'infinity') >= ${from.toISOString()}::timestamptz
    ORDER BY arrived_at
  `);
  return result.rows.map((row) => ({
    arrivedAt: epoch(row.arrived_at),
    departedAt: row.departed_at === null ? null : epoch(row.departed_at),
    endsBy: row.departed_at !== null || row.next_arrival === null ? null : epoch(row.next_arrival),
    lat: row.lat,
    lon: row.lon,
    accuracy: row.horizontal_accuracy,
  }));
}

/** Overland trips overlapping the window, and the one running on the phone now. */
export async function loadTrips(
  db: Executor,
  deviceId: string,
  from: Date,
  to: Date,
  now: Date,
): Promise<ManualTrip[]> {
  const result = await db.execute<{ started_at: string; ended_at: string; mode: string }>(sql`
    SELECT started_at::text, ended_at::text, mode FROM trips
    WHERE device_id = ${deviceId}
      AND started_at < ${to.toISOString()}::timestamptz AND ended_at > ${from.toISOString()}::timestamptz
    UNION ALL
    SELECT live_trip->>'startedAt', ${now.toISOString()}, live_trip->>'mode' FROM devices
    WHERE id = ${deviceId} AND live_trip IS NOT NULL
      AND (live_trip->>'startedAt')::timestamptz < ${to.toISOString()}::timestamptz
  `);
  return result.rows.map((row) => ({
    startedAt: epoch(row.started_at),
    endedAt: epoch(row.ended_at),
    mode: row.mode,
  }));
}

interface OverrideRow extends Record<string, unknown> {
  id: string;
  kind: "segment" | "toggle";
  mode: ChosenMode;
  from_at: string;
  to_at: string | null;
  created_at: string;
  source: "ui" | "api" | "mcp";
  ends_by: string | null;
  stopped_before: boolean;
}

/**
 * The corrections in force for the window. A toggle that began before it gets
 * the start of the first stored segment before the window that ends it — a
 * stay of `toggleEndingStopS` or more that began after it, or a move of
 * another kind of travel after any stay that began after it (`endsToggleSql`)
 * — and whether a stay began between it and the window: a window that starts at the ride home after
 * a short wait must not take that ride for the toggle's own, and the parts the
 * passes left of the stay it was set in are no such stay.
 */
export async function loadOverrides(
  db: Executor,
  deviceId: string,
  from: Date,
  to: Date,
): Promise<OverrideSpan[]> {
  const result = await db.execute<OverrideRow>(sql`
    SELECT o.id, o.kind, o.mode, o.from_at::text, o.to_at::text, o.created_at::text, o.source,
      (SELECT min(s.started_at)::text FROM segments s
        WHERE o.kind = 'toggle' AND s.device_id = o.device_id
          AND s.started_at > o.from_at AND s.started_at < ${from.toISOString()}::timestamptz
          AND ${endsToggleSql("s", "o")}) AS ends_by,
      (o.kind = 'toggle' AND (SELECT 1 FROM segments s
        WHERE s.device_id = o.device_id AND s.kind = 'stop'
          AND s.started_at > o.from_at AND s.started_at < ${from.toISOString()}::timestamptz
          AND NOT ${continuesBeforeSql("s")}
        ORDER BY s.started_at
        LIMIT 1) IS NOT NULL)
        AS stopped_before
    FROM mode_overrides o
    WHERE o.device_id = ${deviceId} AND o.revoked_at IS NULL
      AND o.from_at <= ${to.toISOString()}::timestamptz
      AND (o.to_at IS NULL OR o.to_at >= ${from.toISOString()}::timestamptz)
    ORDER BY o.created_at, o.id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    mode: row.mode,
    from: Date.parse(toIso(row.from_at)) / 1000,
    to: row.to_at === null ? null : Date.parse(toIso(row.to_at)) / 1000,
    endsBy: row.ends_by === null ? null : Date.parse(toIso(row.ends_by)) / 1000,
    stoppedBefore: row.stopped_before,
    createdAt: Date.parse(toIso(row.created_at)) / 1000,
    source: row.source,
  }));
}

interface StayBeforeRow extends Record<string, unknown> {
  started_at: string;
  ended_at: string;
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  centroid_lat: number;
  centroid_lon: number;
  spread_m: number | null;
  stay_started_at: string | null;
}

/**
 * The stored stop the window begins in or right after — an earlier part of a
 * stay its first stop may continue (docs/architecture.md §17.5) — as the
 * window leaves it: ending at the window's start at the latest, where its last
 * point of its own up to there. With when its stay began, if that was after
 * `since` (the earliest start of the window's toggles): a toggle set during
 * the stay is not ended by the window's part of it.
 */
export async function loadStayBefore(
  db: Executor,
  deviceId: string,
  from: Date,
  since: Date,
): Promise<StayBefore | null> {
  const at = from.toISOString();
  const result = await db.execute<StayBeforeRow>(sql`
    SELECT b.started_at::text, least(b.ended_at, ${at}::timestamptz)::text AS ended_at,
      b.start_lat, b.start_lon, coalesce(p.lat_avg, b.end_lat) AS end_lat,
      coalesce(p.lon_avg, b.end_lon) AS end_lon, b.centroid_lat, b.centroid_lon,
      (b.features->>'spreadM')::float8 AS spread_m,
      ${stayStartedAfterSql("b", sql`${since.toISOString()}::timestamptz`)}::text AS stay_started_at
    FROM (
      SELECT * FROM segments
      WHERE device_id = ${deviceId} AND started_at < ${at}::timestamptz
      ORDER BY started_at DESC
      LIMIT 1
    ) b
    LEFT JOIN LATERAL (
      SELECT q.lat_avg, q.lon_avg FROM processed_points q
      WHERE b.ended_at > ${at}::timestamptz AND q.device_id = b.device_id AND q.kept
        AND q.recorded_at >= b.started_at AND q.recorded_at <= ${at}::timestamptz
        AND (b.features->>'lastPointT' IS NULL
          OR q.recorded_at <= to_timestamp((b.features->>'lastPointT')::float8))
      ORDER BY q.recorded_at DESC
      LIMIT 1
    ) p ON true
    WHERE b.kind = 'stop'
  `);
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    startT: epoch(row.started_at),
    endT: epoch(row.ended_at),
    start: { lat: row.start_lat, lon: row.start_lon },
    end: { lat: row.end_lat, lon: row.end_lon },
    centroid: { lat: row.centroid_lat, lon: row.centroid_lon },
    spreadM: row.spread_m,
    stayStartT: row.stay_started_at === null ? null : epoch(row.stay_started_at),
  };
}

interface StoredRow extends Record<string, unknown> {
  recorded_at: string;
  lat_map: number | null;
  lon_map: number | null;
  way_id: string | null;
  way_kind: MappedPoint["wayKind"];
  snap_m: number | null;
  path_map: [number, number][] | null;
  version: number;
}

/**
 * The mapped level stored for the window's points, per point; null where none
 * was stored by `mappedVersion` (the mapped level's current version), and for
 * the points of a stop (no way kind: stops are not matched), so a move made of
 * points that were part of a stop before is matched afresh. Windows queued
 * from the inferred level use it: `--from-level inferred`, and the backfill
 * after a change to the inference.
 */
export async function loadStoredMapping(
  db: Executor,
  deviceId: string,
  points: readonly RawPoint[],
  mappedVersion: number,
): Promise<(MappedPoint | null)[]> {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return [];
  const result = await db.execute<StoredRow>(sql`
    SELECT recorded_at::text, lat_map, lon_map, way_id::text, way_kind, snap_m, path_map, version
    FROM processed_points
    WHERE device_id = ${deviceId}
      AND recorded_at >= to_timestamp(${first.t}) AND recorded_at <= to_timestamp(${last.t})
  `);
  const byTime = new Map<number, MappedPoint>();
  for (const row of result.rows) {
    if (row.version !== mappedVersion || row.lat_map === null || row.lon_map === null) continue;
    if (row.way_kind === null) continue;
    byTime.set(epoch(row.recorded_at), {
      lat: row.lat_map,
      lon: row.lon_map,
      wayId: row.way_id === null ? null : Number(row.way_id),
      wayKind: row.way_kind,
      snapM: row.snap_m,
      path: row.path_map,
    });
  }
  return points.map((point) => byTime.get(point.t) ?? null);
}
