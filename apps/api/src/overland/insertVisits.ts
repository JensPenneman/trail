import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { NormalisedVisit } from "./normaliseVisit";

/** Stores visits, skipping re-sent ones; returns how many were new. */
export async function insertVisits(
  tx: Executor,
  deviceId: string,
  visits: readonly NormalisedVisit[],
): Promise<number> {
  if (visits.length === 0) return 0;
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
  const result = await tx.execute(sql`
    INSERT INTO visits (device_id, recorded_at, arrived_at, departed_at, lat, lon, horizontal_accuracy, extra)
    SELECT ${deviceId}::uuid, r.recorded_at, r.arrived_at, r.departed_at, r.lat, r.lon,
      r.horizontal_accuracy, r.extra
    FROM jsonb_to_recordset(${rows}::jsonb) AS r(
      recorded_at timestamptz, arrived_at timestamptz, departed_at timestamptz,
      lat double precision, lon double precision, horizontal_accuracy real, extra jsonb
    )
    ON CONFLICT (device_id, recorded_at) DO NOTHING
  `);
  return result.rowCount ?? 0;
}
