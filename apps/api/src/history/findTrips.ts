import type { Trip } from "@trail/contracts/trip";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import type { HistoryRange } from "./historyRange";
import { tripTouches } from "./tripTouches";

interface TripRow extends Record<string, unknown> {
  device_id: string;
  started_at: string;
  ended_at: string;
  mode: string;
  distance_m: number | null;
  duration_s: number | null;
  steps: number | null;
  stopped_automatically: boolean;
}

/**
 * Overland trips overlapping `[from, to)` of the devices the principal reaches
 * (for the dashboard's `/api/trips` and v1's `/api/v1/trips`).
 */
export async function findTrips(
  db: Executor,
  access: DeviceAccess,
  range: HistoryRange,
): Promise<Trip[]> {
  const ids = (await resolveDeviceIds(db, access, range.deviceIds)).map((device) => device.id);
  if (ids.length === 0) return [];
  const result = await db.execute<TripRow>(sql`
    SELECT device_id, started_at, ended_at, mode, distance_m, duration_s, steps,
      stopped_automatically
    FROM trips t
    WHERE device_id = ANY(${sql.param(ids)}::uuid[])
      AND ${tripTouches(
        "t",
        sql`${new Date(range.from).toISOString()}::timestamptz`,
        sql`${new Date(range.to).toISOString()}::timestamptz`,
      )}
    ORDER BY started_at, device_id
  `);
  return result.rows.map((row) => ({
    deviceId: row.device_id,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    mode: row.mode,
    distanceM: row.distance_m ?? 0,
    durationS: row.duration_s ?? 0,
    steps: row.steps,
    stoppedAutomatically: row.stopped_automatically,
  }));
}
