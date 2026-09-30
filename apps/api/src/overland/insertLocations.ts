import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { heatCellsUpsert } from "../heatmap/heatCellsUpsert";
import type { NormalisedLocation } from "./normaliseLocation";

/** A point that was actually stored (not a duplicate of an earlier upload). */
export interface InsertedPoint {
  recordedAt: Date;
  lat: number;
  lon: number;
  speed: number | null;
  accuracy: number | null;
  altitude: number | null;
}

interface InsertedRow extends Record<string, unknown> {
  recorded_at: string;
  lat: number;
  lon: number;
  speed: number | null;
  horizontal_accuracy: number | null;
  altitude: number | null;
}

/**
 * Inserts a batch of points in one statement: duplicates are skipped by the
 * primary key, and a data-modifying CTE adds exactly the new points to the heat
 * cells. The batch travels as one JSON parameter (jsonb_to_recordset), which
 * also carries the per-point `motion` arrays.
 */
export async function insertLocations(
  tx: Executor,
  deviceId: string,
  points: readonly NormalisedLocation[],
): Promise<InsertedPoint[]> {
  if (points.length === 0) return [];
  const rows = JSON.stringify(
    points.map((point) => ({
      recorded_at: point.recordedAt.toISOString(),
      lat: point.lat,
      lon: point.lon,
      altitude: point.altitude,
      speed: point.speed,
      course: point.course,
      horizontal_accuracy: point.horizontalAccuracy,
      vertical_accuracy: point.verticalAccuracy,
      speed_accuracy: point.speedAccuracy,
      course_accuracy: point.courseAccuracy,
      motion: point.motion,
      battery_level: point.batteryLevel,
      battery_state: point.batteryState,
      wifi: point.wifi,
      extra: point.extra,
    })),
  );
  const result = await tx.execute<InsertedRow>(sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${rows}::jsonb) AS r(
        recorded_at timestamptz, lat double precision, lon double precision, altitude real,
        speed real, course real, horizontal_accuracy real, vertical_accuracy real,
        speed_accuracy real, course_accuracy real, motion text[], battery_level real,
        battery_state text, wifi text, extra jsonb
      )
    ),
    inserted AS (
      INSERT INTO locations (
        device_id, recorded_at, lat, lon, altitude, speed, course, horizontal_accuracy,
        vertical_accuracy, speed_accuracy, course_accuracy, motion, battery_level, battery_state,
        wifi, extra
      )
      SELECT ${deviceId}::uuid, recorded_at, lat, lon, altitude, speed, course, horizontal_accuracy,
        vertical_accuracy, speed_accuracy, course_accuracy, coalesce(motion, '{}'::text[]),
        battery_level, battery_state, wifi, extra
      FROM input
      ON CONFLICT (device_id, recorded_at) DO NOTHING
      RETURNING recorded_at, lat, lon, speed, horizontal_accuracy, altitude
    ),
    cells AS (${heatCellsUpsert(deviceId, sql.raw("inserted"))})
    SELECT recorded_at, lat, lon, speed, horizontal_accuracy, altitude
    FROM inserted
    ORDER BY recorded_at
  `);
  return result.rows.map((row) => ({
    recordedAt: new Date(toIso(row.recorded_at)),
    lat: row.lat,
    lon: row.lon,
    speed: row.speed,
    accuracy: row.horizontal_accuracy,
    altitude: row.altitude,
  }));
}
