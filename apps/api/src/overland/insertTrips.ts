import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { NormalisedTrip } from "./normaliseTrip";

/** Stores finished trips, skipping re-sent ones; returns how many were new. */
export async function insertTrips(
  tx: Executor,
  deviceId: string,
  trips: readonly NormalisedTrip[],
): Promise<number> {
  if (trips.length === 0) return 0;
  const rows = JSON.stringify(
    trips.map((trip) => ({
      started_at: trip.startedAt.toISOString(),
      ended_at: trip.endedAt.toISOString(),
      mode: trip.mode,
      distance_m: trip.distanceM,
      duration_s: trip.durationS,
      steps: trip.steps,
      stopped_automatically: trip.stoppedAutomatically,
      start_location: trip.startLocation,
      end_location: trip.endLocation,
      extra: trip.extra,
    })),
  );
  const result = await tx.execute(sql`
    INSERT INTO trips (
      device_id, started_at, ended_at, mode, distance_m, duration_s, steps, stopped_automatically,
      start_location, end_location, extra
    )
    SELECT ${deviceId}::uuid, r.started_at, r.ended_at, r.mode, r.distance_m, r.duration_s, r.steps,
      r.stopped_automatically, r.start_location, r.end_location, r.extra
    FROM jsonb_to_recordset(${rows}::jsonb) AS r(
      started_at timestamptz, ended_at timestamptz, mode text, distance_m double precision,
      duration_s double precision, steps integer, stopped_automatically boolean,
      start_location jsonb, end_location jsonb, extra jsonb
    )
    ON CONFLICT (device_id, started_at) DO NOTHING
  `);
  return result.rowCount ?? 0;
}
