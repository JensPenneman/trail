import type { Visit } from "@trail/contracts/visit";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso, toIsoOrNull } from "../db/toIso";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import type { HistoryRange } from "./historyRange";

interface VisitRow extends Record<string, unknown> {
  device_id: string;
  recorded_at: string;
  arrived_at: string | null;
  departed_at: string | null;
  lat: number;
  lon: number;
  horizontal_accuracy: number | null;
}

/**
 * Visits touching `[from, to)` of the devices the principal reaches (for the
 * dashboard's `/api/visits` and v1's `/api/v1/visits`). iOS reports a visit on
 * arrival and again on departure (same arrival time); the two reports are
 * merged, preferring the one that knows the departure.
 */
export async function findVisits(
  db: Executor,
  access: DeviceAccess,
  range: HistoryRange,
): Promise<Visit[]> {
  const ids = (await resolveDeviceIds(db, access, range.deviceIds)).map((device) => device.id);
  if (ids.length === 0) return [];
  const from = new Date(range.from).toISOString();
  const to = new Date(range.to).toISOString();
  const result = await db.execute<VisitRow>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (device_id, coalesce(arrived_at, recorded_at))
        device_id, recorded_at, arrived_at, departed_at, lat, lon, horizontal_accuracy
      FROM visits
      WHERE device_id = ANY(${sql.param(ids)}::uuid[])
        AND (
          (recorded_at >= ${from}::timestamptz AND recorded_at < ${to}::timestamptz)
          OR (arrived_at >= ${from}::timestamptz AND arrived_at < ${to}::timestamptz)
          OR (departed_at >= ${from}::timestamptz AND departed_at < ${to}::timestamptz)
          OR (arrived_at < ${from}::timestamptz AND departed_at >= ${to}::timestamptz)
        )
      ORDER BY device_id, coalesce(arrived_at, recorded_at), departed_at DESC NULLS LAST,
        recorded_at DESC
    ) merged
    ORDER BY coalesce(arrived_at, recorded_at), device_id
  `);
  return result.rows.map((row) => ({
    deviceId: row.device_id,
    recordedAt: toIso(row.recorded_at),
    arrivedAt: toIsoOrNull(row.arrived_at),
    departedAt: toIsoOrNull(row.departed_at),
    lat: row.lat,
    lon: row.lon,
    accuracy: row.horizontal_accuracy,
  }));
}
