import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { type PiecePoint, pieceValues } from "./pieceValues";
import type { RawPoint } from "./pipelineTypes";
import type { ProcessingConfig } from "./processingConfig";
import { enqueueWindow, queuePriority } from "./processingQueue";
import type { ProcessingVersions } from "./processingVersion";
import type { WindowResult } from "./runPipeline";

/** Rows per statement when writing processed points. */
const chunkSize = 5000;

const iso = (epochSeconds: number): string => new Date(epochSeconds * 1000).toISOString();

/** A stored segment cut at a window's edge: the part that stays. */
interface PieceRow extends Record<string, unknown> {
  id: string;
  kind: "stop" | "move";
  started_at: string;
  ended_at: string;
  version: number;
  features: Record<string, unknown> | null;
}

interface PiecePointRow extends Record<string, unknown> {
  t: number;
  lat_avg: number;
  lon_avg: number;
  lat_map: number | null;
  lon_map: number | null;
  path_map: [number, number][] | null;
  speed_avg: number | null;
}

/**
 * The part of a stored segment a window cut off works out what it holds of
 * its own (`pieceValues`) — its points, a stop's own only — and, left by
 * another version of the inference, is queued to be worked out again.
 */
async function workOutPiece(
  tx: Executor,
  deviceId: string,
  piece: PieceRow,
  options: { versions: ProcessingVersions; config: ProcessingConfig },
): Promise<void> {
  const features = piece.features ?? {};
  const startT = Date.parse(toIso(piece.started_at)) / 1000;
  const endT = Date.parse(toIso(piece.ended_at)) / 1000;
  const lastPointT = features["lastPointT"];
  const ownEnd =
    piece.kind === "stop" && typeof lastPointT === "number" ? Math.min(endT, lastPointT) : endT;
  // One range of the primary key, nothing joined: a part of a stale stop can hold days of points.
  const rows = await tx.execute<PiecePointRow>(sql`
    SELECT extract(epoch FROM p.recorded_at)::float8 AS t, p.lat_avg, p.lon_avg, p.lat_map,
      p.lon_map, p.path_map, p.speed_avg
    FROM processed_points p
    WHERE p.device_id = ${deviceId} AND p.kept
      AND p.recorded_at >= ${piece.started_at}::timestamptz
      AND p.recorded_at <= ${new Date(ownEnd * 1000).toISOString()}::timestamptz
    ORDER BY p.recorded_at
  `);
  // The processed points keep no accuracy: the part's middle weighs them alike.
  const points = rows.rows.map(
    (row): PiecePoint => ({
      t: Math.round(row.t),
      latAvg: row.lat_avg,
      lonAvg: row.lon_avg,
      latMap: row.lat_map,
      lonMap: row.lon_map,
      pathMap: row.path_map,
      speed: row.speed_avg,
      accuracy: options.config.averaging.defaultAccuracyM,
    }),
  );
  const values = pieceValues(piece.kind, points, { startT, endT }, features);
  await tx.execute(sql`
    UPDATE segments SET point_count = ${values.pointCount}, distance_m = ${values.distanceM},
      start_lat = coalesce(${values.start?.lat ?? null}::float8, start_lat),
      start_lon = coalesce(${values.start?.lon ?? null}::float8, start_lon),
      end_lat = coalesce(${values.end?.lat ?? null}::float8, end_lat),
      end_lon = coalesce(${values.end?.lon ?? null}::float8, end_lon),
      centroid_lat = coalesce(${values.centroid?.lat ?? null}::float8, centroid_lat),
      centroid_lon = coalesce(${values.centroid?.lon ?? null}::float8, centroid_lon),
      features = ${JSON.stringify(values.features)}::jsonb
    WHERE id = ${piece.id}
  `);
  if (piece.version !== options.versions.inferred) {
    await enqueueWindow(tx, {
      deviceId,
      from: new Date(startT * 1000),
      to: new Date(endT * 1000),
      reason: "backfill",
      fromLevel: "inferred",
      priority: queuePriority.backfill,
    });
  }
}

/**
 * Writes a processed window (docs/architecture.md §17.2) — its points' averaged
 * and mapped levels and its stops and moves — in the caller's transaction.
 * Points deleted meanwhile are skipped; segments keep their ids where their
 * start stays. The window has grown to whole segments, but at most two days
 * out (§17.4): a segment that began before it ends at its start, and the part
 * of one that reaches beyond its end stays, starting at the end, so no time
 * is lost from the timeline. Each part counts what it holds of its own (its
 * points, distance, ends and middle) and keeps its mode until a window over it
 * works it out again; a part left by another version of the inference is
 * queued for that. The point the window shares with a segment that
 * began before it keeps its stored levels: that segment was worked out with it
 * (a move's mapping is not overwritten by a stop's, nor taken for a stop's
 * later). A point records the mapped level's version (it holds the averaged
 * and mapped levels), a segment the inferred level's.
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
    config: ProcessingConfig;
  },
): Promise<void> {
  const { deviceId, raw, result, versions } = input;
  // The point the window shares with a segment that began before it is that segment's too.
  const firstAt = iso(raw[0]?.t ?? 0);
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
      WHERE NOT (
        processed_points.recorded_at = ${firstAt}::timestamptz
        AND processed_points.version = ${versions.mapped}
        AND EXISTS (
          SELECT 1 FROM segments s
          WHERE s.device_id = ${deviceId}::uuid AND s.started_at < ${input.from.toISOString()}::timestamptz
            AND s.ended_at = processed_points.recorded_at
        )
      )
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
  const tails = await tx.execute<PieceRow>(sql`
    INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, mode_user,
      confidence, review, distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat,
      end_lon, centroid_lat, centroid_lon, features, version, computed_at)
    SELECT device_id, ${to}::timestamptz, ended_at, kind, mode, mode_inferred, mode_user, confidence,
      review, distance_m, extract(epoch FROM ended_at - ${to}::timestamptz)::integer, max_speed,
      point_count, start_lat, start_lon, end_lat, end_lon, centroid_lat, centroid_lon, features, version,
      computed_at
    FROM segments
    WHERE device_id = ${deviceId} AND started_at < ${to}::timestamptz AND ended_at > ${to}::timestamptz
    ON CONFLICT (device_id, started_at) DO NOTHING
    RETURNING id, kind, started_at::text, ended_at::text, version, features
  `);
  const heads = await tx.execute<PieceRow>(sql`
    UPDATE segments SET ended_at = ${from}::timestamptz,
      duration_s = extract(epoch FROM ${from}::timestamptz - started_at)::integer
    WHERE device_id = ${deviceId} AND started_at < ${from}::timestamptz AND ended_at > ${from}::timestamptz
    RETURNING id, kind, started_at::text, ended_at::text, version, features
  `);
  for (const piece of [...heads.rows, ...tails.rows]) {
    await workOutPiece(tx, deviceId, piece, input);
  }
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
