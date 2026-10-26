import type { ActivityResponse } from "@trail/contracts/stats";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";

interface BucketRow extends Record<string, unknown> {
  start: string;
  device_id: string;
  recorded: number;
  uploads: number;
}

/**
 * Hourly buckets over the last `hours` (the current hour included) for the
 * devices the principal reaches: points recorded and uploads received — the
 * "is data still flowing" chart of `/api/stats/activity` and v1's
 * `/api/v1/stats/activity`.
 */
export async function findActivity(
  db: Executor,
  access: DeviceAccess,
  query: { hours: number; deviceIds?: readonly string[] | undefined },
  now: Date = new Date(),
): Promise<ActivityResponse> {
  const ids = (await resolveDeviceIds(db, access, query.deviceIds)).map((device) => device.id);
  const currentHour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const from = new Date(currentHour.getTime() - (query.hours - 1) * 3_600_000);
  const to = new Date(currentHour.getTime() + 3_600_000);
  if (ids.length === 0) return { from: from.toISOString(), to: to.toISOString(), buckets: [] };

  // Every hour × device, zeros included, so the client can draw the series as-is.
  const result = await db.execute<BucketRow>(sql`
    WITH hours AS (
      SELECT generate_series(${from.toISOString()}::timestamptz,
        ${currentHour.toISOString()}::timestamptz, interval '1 hour') AS start
    ),
    ids AS (SELECT unnest(${sql.param(ids)}::uuid[]) AS device_id),
    recorded AS (
      SELECT device_id, date_trunc('hour', recorded_at, 'UTC') AS start, count(*)::int AS n
      FROM locations
      WHERE device_id = ANY(${sql.param(ids)}::uuid[])
        AND recorded_at >= ${from.toISOString()}::timestamptz
        AND recorded_at < ${to.toISOString()}::timestamptz
      GROUP BY 1, 2
    ),
    uploads AS (
      SELECT device_id, date_trunc('hour', received_at, 'UTC') AS start, count(*)::int AS n
      FROM ingest_log
      WHERE device_id = ANY(${sql.param(ids)}::uuid[])
        AND received_at >= ${from.toISOString()}::timestamptz
        AND received_at < ${to.toISOString()}::timestamptz
      GROUP BY 1, 2
    )
    SELECT h.start, i.device_id, coalesce(r.n, 0) AS recorded, coalesce(u.n, 0) AS uploads
    FROM hours h
    CROSS JOIN ids i
    LEFT JOIN recorded r ON r.device_id = i.device_id AND r.start = h.start
    LEFT JOIN uploads u ON u.device_id = i.device_id AND u.start = h.start
    ORDER BY h.start, i.device_id
  `);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    buckets: result.rows.map((row) => ({
      start: toIso(row.start),
      deviceId: row.device_id,
      recorded: row.recorded,
      uploads: row.uploads,
    })),
  };
}
