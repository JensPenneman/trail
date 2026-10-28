import type { DeviceSummary } from "@trail/contracts/device";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { allowedDeviceIds, type DeviceAccess } from "./deviceAccess";
import { deviceSummaryColumns } from "./deviceSummaryColumns";
import { type DeviceSummaryRow, toDeviceSummary } from "./toDeviceSummary";

/**
 * Summaries of the devices the principal may reach (or one of them). The
 * latest position and battery come from the device cache; only the "today" and
 * "last 24 h" counts touch `locations`, as index range scans on (device_id,
 * recorded_at). "Today" starts at local midnight in the owner's time zone.
 */
export async function loadDeviceSummaries(
  db: Executor,
  access: DeviceAccess,
  deviceId?: string,
): Promise<DeviceSummary[]> {
  const allowed = allowedDeviceIds(access);
  if (allowed?.length === 0) return [];
  const onlyDevice = deviceId === undefined ? sql`` : sql`AND d.id = ${deviceId}`;
  const onlyAllowed =
    allowed === null ? sql`` : sql`AND d.id = ANY(${sql.param([...allowed])}::uuid[])`;
  const result = await db.execute<DeviceSummaryRow>(sql`
    SELECT ${deviceSummaryColumns}, counts.today, counts.last24h
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
    WHERE d.user_id = ${access.user.id} ${onlyDevice} ${onlyAllowed}
    ORDER BY d.created_at, d.id
  `);
  return result.rows.map(toDeviceSummary);
}
