import type { DayStat } from "@trail/contracts/stats";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";

interface DayRow extends Record<string, unknown> {
  device_id: string;
  date: string;
  points: number;
  distance_m: number;
  first_at: string;
  last_at: string;
}

/**
 * Per-day totals of local calendar days `from`..`to` (both included, the
 * owner's time zone) for the devices the principal reaches — for the
 * dashboard's `/api/stats/days` and v1's `/api/v1/stats/days`.
 */
export async function findDayStats(
  db: Executor,
  access: DeviceAccess,
  query: { from: string; to: string; deviceIds?: readonly string[] | undefined },
): Promise<DayStat[]> {
  const ids = (await resolveDeviceIds(db, access, query.deviceIds)).map((device) => device.id);
  if (ids.length === 0) return [];
  const result = await db.execute<DayRow>(sql`
    SELECT device_id, date::text AS date, points, distance_m, first_at, last_at
    FROM daily_stats
    WHERE device_id = ANY(${sql.param(ids)}::uuid[])
      AND date BETWEEN ${query.from}::date AND ${query.to}::date
    ORDER BY date, device_id
  `);
  return result.rows.map((row) => ({
    date: row.date,
    deviceId: row.device_id,
    points: row.points,
    distanceM: row.distance_m,
    firstAt: toIso(row.first_at),
    lastAt: toIso(row.last_at),
  }));
}
