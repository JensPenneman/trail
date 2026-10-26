import type { ModeStatsResponse, TransportMode } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";

interface StatRow extends Record<string, unknown> {
  date: string;
  device_id: string;
  mode: TransportMode;
  distance_m: number;
  duration_s: number;
  segments: number;
  set_by_user: number;
}

/**
 * Distance and time per local day and mode (docs/architecture.md §17.6), in
 * the account's time zone. A segment across midnight counts on both days in
 * proportion to its time there; stops count as `stationary`.
 */
export async function loadModeStats(
  db: Executor,
  access: DeviceAccess & { user: { id: string; timezone: string } },
  query: { devices?: readonly string[] | undefined; from: string; to: string },
): Promise<ModeStatsResponse> {
  const timezone = access.user.timezone;
  const owned = await resolveDeviceIds(db, access, query.devices);
  const ids = owned.map((device) => device.id);
  if (ids.length === 0) return { timezone, days: [] };
  const result = await db.execute<StatRow>(sql`
    WITH days AS (
      SELECT day::date AS date,
        (day::date)::timestamp AT TIME ZONE ${timezone} AS day_start,
        (day::date + 1)::timestamp AT TIME ZONE ${timezone} AS day_end
      FROM generate_series(${query.from}::date, ${query.to}::date, interval '1 day') AS day
    )
    SELECT days.date::text AS date, s.device_id,
      coalesce(s.mode_user, s.mode_inferred, 'stationary') AS mode,
      round(sum(CASE WHEN s.duration_s > 0 THEN s.distance_m * overlap.seconds / s.duration_s
        ELSE s.distance_m END)::numeric, 1)::float8 AS distance_m,
      round(sum(overlap.seconds)::numeric)::float8 AS duration_s,
      count(*)::int AS segments,
      count(*) FILTER (WHERE s.mode_user IS NOT NULL)::int AS set_by_user
    FROM days
    JOIN segments s ON s.device_id = ANY(${sql.param(ids)}::uuid[])
      AND s.started_at < days.day_end AND s.ended_at >= days.day_start
      AND (s.ended_at > days.day_start OR s.started_at = s.ended_at)
    CROSS JOIN LATERAL (
      SELECT extract(epoch FROM least(s.ended_at, days.day_end) - greatest(s.started_at, days.day_start))::float8 AS seconds
    ) overlap
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `);
  return {
    timezone,
    days: result.rows.map((row) => ({
      date: row.date,
      deviceId: row.device_id,
      mode: row.mode,
      distanceM: row.distance_m,
      durationS: row.duration_s,
      segments: row.segments,
      setByUser: row.set_by_user,
    })),
  };
}
