import { sql } from "drizzle-orm";

/**
 * The columns of `devices d` a summary shows (`DeviceSummaryRow` without its
 * counts): what `loadDeviceSummaries` reads and what the device list's ETag
 * hashes (`deviceListValidator`), so a column a summary gains changes both.
 */
export const deviceSummaryColumns = sql.raw(`
  d.id, d.name, d.source, d.device_key, d.token_hint, d.alerts_enabled, d.created_at,
  d.last_seen_at, d.last_recorded_at, d.last_lat, d.last_lon, d.last_accuracy, d.last_speed,
  d.last_altitude, d.last_course, d.last_motion, d.battery_level, d.battery_state,
  d.battery_recorded_at, d.live_trip, d.points_total, d.pending_settings, d.settings_applied_at
`);
