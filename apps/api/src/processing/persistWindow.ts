import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { RawPoint } from "./pipelineTypes";
import type { ProcessingVersions } from "./processingVersion";
import type { WindowResult } from "./runPipeline";

/** Rows per statement when writing processed points. */
const chunkSize = 5000;

const iso = (epochSeconds: number): string => new Date(epochSeconds * 1000).toISOString();

/**
 * Writes a processed window (docs/architecture.md §17.2) — its points' averaged
 * and mapped levels and its stops and moves — in the caller's transaction.
 * Points deleted meanwhile are skipped; segments keep their ids where their
 * start stays; a segment that began before the window ends at its start.
 * A point records the mapped level's version (it holds the averaged and mapped
 * levels), a segment the inferred level's.
 */
export async function persistWindow(
  tx: Executor,
  input: {
    deviceId: string;
    from: Date;
    to: Date;
    raw: readonly RawPoint[];
    result: WindowResult;
    versions: ProcessingVersions;
  },
): Promise<void> {
  const { deviceId, raw, result, versions } = input;
  const rows = raw.map((point, index) => {
    const averaged = result.averaged[index];
    const mapped = result.mapped[index] ?? null;
    return {
      recorded_at: iso(point.t),
      kept: averaged?.kept ?? false,
      lat_avg: averaged?.lat ?? point.lat,
      lon_avg: averaged?.lon ?? point.lon,
      speed_avg: averaged?.kept === true ? Math.round(averaged.speed * 100) / 100 : null,
      lat_map: mapped?.lat ?? null,
      lon_map: mapped?.lon ?? null,
      way_id: mapped?.wayId ?? null,
      way_kind: mapped?.wayKind ?? null,
      snap_m:
        mapped?.snapM === null || mapped?.snapM === undefined
          ? null
          : Math.round(mapped.snapM * 10) / 10,
      path_map: mapped?.path ?? null,
    };
  });
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = JSON.stringify(rows.slice(start, start + chunkSize));
    await tx.execute(sql`
      INSERT INTO processed_points (device_id, recorded_at, kept, lat_avg, lon_avg, speed_avg, lat_map,
        lon_map, way_id, way_kind, snap_m, path_map, version, processed_at)
      SELECT ${deviceId}::uuid, r.recorded_at, r.kept, r.lat_avg, r.lon_avg, r.speed_avg, r.lat_map,
        r.lon_map, r.way_id, r.way_kind, r.snap_m, r.path_map, ${versions.mapped}, now()
      FROM jsonb_to_recordset(${chunk}::jsonb) AS r(
        recorded_at timestamptz, kept boolean, lat_avg double precision, lon_avg double precision,
        speed_avg real, lat_map double precision, lon_map double precision, way_id bigint,
        way_kind text, snap_m real, path_map jsonb
      )
      JOIN locations l ON l.device_id = ${deviceId}::uuid AND l.recorded_at = r.recorded_at
      ON CONFLICT (device_id, recorded_at) DO UPDATE SET
        kept = excluded.kept, lat_avg = excluded.lat_avg, lon_avg = excluded.lon_avg,
        speed_avg = excluded.speed_avg, lat_map = excluded.lat_map, lon_map = excluded.lon_map,
        way_id = excluded.way_id, way_kind = excluded.way_kind, snap_m = excluded.snap_m,
        path_map = excluded.path_map, version = excluded.version, processed_at = excluded.processed_at
    `);
  }

  const from = input.from.toISOString();
  const to = input.to.toISOString();
  const segments = result.segments.map((segment) => ({
    started_at: iso(segment.startT),
    ended_at: iso(segment.endT),
    kind: segment.kind,
    mode: segment.modeUser ?? segment.modeInferred,
    mode_inferred: segment.modeInferred,
    mode_user: segment.modeUser,
    confidence: segment.confidence,
    review: segment.features["review"] === true,
    distance_m: segment.distanceM,
    duration_s: segment.endT - segment.startT,
    max_speed: segment.maxSpeedMs,
    point_count: segment.pointCount,
    start_lat: segment.start.lat,
    start_lon: segment.start.lon,
    end_lat: segment.end.lat,
    end_lon: segment.end.lon,
    centroid_lat: segment.centroid.lat,
    centroid_lon: segment.centroid.lon,
    features: segment.features,
  }));
  await tx.execute(sql`
    UPDATE segments SET ended_at = ${from}::timestamptz,
      duration_s = extract(epoch FROM ${from}::timestamptz - started_at)::integer
    WHERE device_id = ${deviceId} AND started_at < ${from}::timestamptz AND ended_at > ${from}::timestamptz
  `);
  await tx.execute(sql`
    DELETE FROM segments
    WHERE device_id = ${deviceId}
      AND started_at >= ${from}::timestamptz AND started_at < ${to}::timestamptz
      AND NOT (started_at = ANY(${sql.param(segments.map((segment) => segment.started_at))}::timestamptz[]))
  `);
  if (segments.length === 0) return;
  await tx.execute(sql`
    INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, mode_user,
      confidence, review, distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat,
      end_lon, centroid_lat, centroid_lon, features, version, computed_at)
    SELECT ${deviceId}::uuid, started_at, ended_at, kind, mode, mode_inferred, mode_user, confidence,
      review, distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
      centroid_lat, centroid_lon, features, ${versions.inferred}, now()
    FROM jsonb_to_recordset(${JSON.stringify(segments)}::jsonb) AS r(
      started_at timestamptz, ended_at timestamptz, kind text, mode text, mode_inferred text,
      mode_user text, confidence real, review boolean, distance_m double precision,
      duration_s integer, max_speed real, point_count integer, start_lat double precision,
      start_lon double precision, end_lat double precision, end_lon double precision,
      centroid_lat double precision, centroid_lon double precision, features jsonb
    )
    ON CONFLICT (device_id, started_at) DO UPDATE SET
      ended_at = excluded.ended_at, kind = excluded.kind, mode = excluded.mode,
      mode_inferred = excluded.mode_inferred, mode_user = excluded.mode_user,
      confidence = excluded.confidence, review = excluded.review, distance_m = excluded.distance_m,
      duration_s = excluded.duration_s, max_speed = excluded.max_speed,
      point_count = excluded.point_count, start_lat = excluded.start_lat,
      start_lon = excluded.start_lon, end_lat = excluded.end_lat, end_lon = excluded.end_lon,
      centroid_lat = excluded.centroid_lat, centroid_lon = excluded.centroid_lon,
      features = excluded.features, version = excluded.version, computed_at = excluded.computed_at
  `);
}
