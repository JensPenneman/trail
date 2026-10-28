import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type { NormalisedTrip } from "./normalisedRecords";

/** A trip this upload stored: the times that decide which days it touches. */
export interface InsertedTrip {
  startedAt: Date;
  endedAt: Date;
}

/** Stores finished trips, skipping re-sent ones; returns the new ones. */
export async function insertTrips(
  tx: Executor,
  deviceId: string,
  trips: readonly NormalisedTrip[],
): Promise<InsertedTrip[]> {
  if (trips.length === 0) return [];
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
  const result = await tx.execute<{ started_at: string; ended_at: string }>(sql`
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
    RETURNING started_at::text, ended_at::text
  `);
  return result.rows.map((row) => ({
    startedAt: new Date(toIso(row.started_at)),
    endedAt: new Date(toIso(row.ended_at)),
  }));
}
