import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { NormalisedEvent } from "./normaliseEvent";

/** Stores app/tracking log events, skipping re-sent ones; returns how many were new. */
export async function insertEvents(
  tx: Executor,
  deviceId: string,
  events: readonly NormalisedEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  const rows = JSON.stringify(
    events.map((event) => ({
      recorded_at: event.recordedAt.toISOString(),
      action: event.action,
      lat: event.lat,
      lon: event.lon,
      extra: event.extra,
    })),
  );
  const result = await tx.execute(sql`
    INSERT INTO device_events (device_id, recorded_at, action, lat, lon, extra)
    SELECT ${deviceId}::uuid, r.recorded_at, r.action, r.lat, r.lon, r.extra
    FROM jsonb_to_recordset(${rows}::jsonb) AS r(
      recorded_at timestamptz, action text, lat double precision, lon double precision, extra jsonb
    )
    ON CONFLICT (device_id, recorded_at, action) DO NOTHING
  `);
  return result.rowCount ?? 0;
}
