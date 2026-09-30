import type { DeviceSummary } from "@trail/contracts/device";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { type DeviceSummaryRow, toDeviceSummary } from "./toDeviceSummary";

/**
 * Summaries of a user's devices (or one of them). The latest position and
 * battery come from the device cache; only the "today" and "last 24 h" counts
 * touch `locations`, as index range scans on (device_id, recorded_at).
 * "Today" starts at local midnight in the owner's time zone.
 */
export async function loadDeviceSummaries(
  db: Executor,
  filter: { userId: string; deviceId?: string },
): Promise<DeviceSummary[]> {
  const onlyDevice = filter.deviceId === undefined ? sql`` : sql`AND d.id = ${filter.deviceId}`;
  const result = await db.execute<DeviceSummaryRow>(sql`
    SELECT d.id, d.name, d.device_key, d.token_hint, d.alerts_enabled, d.created_at,
      d.last_seen_at, d.last_recorded_at, d.last_lat, d.last_lon, d.last_accuracy, d.last_speed,
      d.last_altitude, d.last_course, d.last_motion, d.battery_level, d.battery_state,
      d.battery_recorded_at, d.live_trip, d.points_total, d.pending_settings, d.settings_applied_at,
      counts.today, counts.last24h
    FROM devices d
    JOIN users u ON u.id = d.user_id
    CROSS JOIN LATERAL (
      SELECT date_trunc('day', now() AT TIME ZONE u.timezone) AT TIME ZONE u.timezone AS day_start,
        now() - interval '24 hours' AS day_ago
    ) bounds
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE l.recorded_at >= bounds.day_start)::int AS today,
        count(*) FILTER (WHERE l.recorded_at >= bounds.day_ago)::int AS last24h
      FROM locations l
      WHERE l.device_id = d.id AND l.recorded_at >= least(bounds.day_start, bounds.day_ago)
    ) counts
    WHERE d.user_id = ${filter.userId} ${onlyDevice}
    ORDER BY d.created_at, d.id
  `);
  return result.rows.map(toDeviceSummary);
}
