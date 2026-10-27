import { type ChosenMode, toggleEndingStopS } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type { ManualTrip, MappedPoint, OverrideSpan, RawPoint, VisitSpan } from "./pipelineTypes";

/** Rows per round trip when reading a window's points. */
const pageSize = 20_000;
/** How far a window grows to take in the segments at its edges, at most. */
const maxExtensionMs = 2 * 86_400_000;

const epoch = (value: string): number => Math.round(Date.parse(toIso(value)) / 1000);

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
 * such gap: the window starts where it did.
 */
export async function extendWindow(
  db: Executor,
  deviceId: string,
  window: { from: Date; to: Date },
  gapSplitS: number,
): Promise<{ from: Date; to: Date }> {
  const { from, to } = window;
  const result = await db.execute<{ first: string | null; last: string | null }>(sql`
    SELECT min(started_at)::text AS first, max(ended_at)::text AS last
    FROM segments
    WHERE device_id = ${deviceId}
      AND started_at <= ${to.toISOString()}::timestamptz
      AND ended_at >= ${from.toISOString()}::timestamptz
  `);
  const row = result.rows[0];
  let first = row?.first === null || row?.first === undefined ? from : new Date(toIso(row.first));
  const last = row?.last === null || row?.last === undefined ? to : new Date(toIso(row.last));
  const start = new Date(Math.min(first.getTime(), from.getTime()));
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
      const reach = previous !== undefined ? Date.parse(toIso(previous.started_at)) : holeFrom;
      first = new Date(Math.min(first.getTime(), reach));
    }
  }
  return {
    from: new Date(
      Math.max(Math.min(first.getTime(), from.getTime()), from.getTime() - maxExtensionMs),
    ),
    to: new Date(Math.min(Math.max(last.getTime(), to.getTime()), to.getTime() + maxExtensionMs)),
  };
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
}

/**
 * The corrections in force for the window. A toggle that began before it gets
 * the start of the first stop of `toggleEndingStopS` or more after it among
 * the stored segments before the window, which ends it.
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
        WHERE o.kind = 'toggle' AND s.device_id = o.device_id AND s.kind = 'stop'
          AND s.started_at > o.from_at AND s.started_at < ${from.toISOString()}::timestamptz
          AND s.ended_at - s.started_at >= make_interval(secs => ${toggleEndingStopS})) AS ends_by
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
    createdAt: Date.parse(toIso(row.created_at)) / 1000,
    source: row.source,
  }));
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
