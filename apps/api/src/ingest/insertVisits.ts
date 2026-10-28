import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type { NormalisedVisit } from "./normalisedRecords";

/** A visit this upload stored: the times that decide which days it touches. */
export interface InsertedVisit {
  recordedAt: Date;
  arrivedAt: Date | null;
  departedAt: Date | null;
}

interface InsertedVisitRow extends Record<string, unknown> {
  recorded_at: string;
  arrived_at: string | null;
  departed_at: string | null;
}

const atOrNull = (value: string | null): Date | null =>
  value === null ? null : new Date(toIso(value));

/** Stores visits, skipping re-sent ones; returns the new ones. */
export async function insertVisits(
  tx: Executor,
  deviceId: string,
  visits: readonly NormalisedVisit[],
): Promise<InsertedVisit[]> {
  if (visits.length === 0) return [];
  const rows = JSON.stringify(
    visits.map((visit) => ({
      recorded_at: visit.recordedAt.toISOString(),
      arrived_at: visit.arrivedAt?.toISOString() ?? null,
      departed_at: visit.departedAt?.toISOString() ?? null,
      lat: visit.lat,
      lon: visit.lon,
      horizontal_accuracy: visit.horizontalAccuracy,
      extra: visit.extra,
    })),
  );
  const result = await tx.execute<InsertedVisitRow>(sql`
    INSERT INTO visits (device_id, recorded_at, arrived_at, departed_at, lat, lon, horizontal_accuracy, extra)
    SELECT ${deviceId}::uuid, r.recorded_at, r.arrived_at, r.departed_at, r.lat, r.lon,
      r.horizontal_accuracy, r.extra
    FROM jsonb_to_recordset(${rows}::jsonb) AS r(
      recorded_at timestamptz, arrived_at timestamptz, departed_at timestamptz,
      lat double precision, lon double precision, horizontal_accuracy real, extra jsonb
    )
    ON CONFLICT (device_id, recorded_at) DO NOTHING
    RETURNING recorded_at::text, arrived_at::text, departed_at::text
  `);
  return result.rows.map((row) => ({
    recordedAt: new Date(toIso(row.recorded_at)),
    arrivedAt: atOrNull(row.arrived_at),
    departedAt: atOrNull(row.departed_at),
  }));
}
