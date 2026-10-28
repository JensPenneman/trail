import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { allowedDeviceIds, type DeviceAccess } from "./deviceAccess";
import { deviceSummaryColumns } from "./deviceSummaryColumns";

/**
 * What `GET /api/devices` is made of, without counting a day of points
 * (docs/architecture.md §8.9): the summaries' columns of every device the
 * principal reaches, the owner's current day — "today" starts again at
 * midnight — and each device's oldest point of the last 24 hours, which moves
 * when one ages out of the 24-hour count: one index seek per device. Uploads
 * and deletions move the counter and the cached position. Read before the
 * summaries, as every validator is.
 */
export async function deviceListValidator(db: Executor, access: DeviceAccess): Promise<unknown[]> {
  const allowed = allowedDeviceIds(access);
  if (allowed?.length === 0) return [];
  const onlyAllowed =
    allowed === null ? sql`` : sql`AND d.id = ANY(${sql.param([...allowed])}::uuid[])`;
  const result = await db.execute(sql`
    SELECT ${deviceSummaryColumns},
      (now() AT TIME ZONE u.timezone)::date::text AS today,
      (
        SELECT l.recorded_at::text FROM locations l
        WHERE l.device_id = d.id AND l.recorded_at >= now() - interval '24 hours'
        ORDER BY l.recorded_at
        LIMIT 1
      ) AS oldest_of_day
    FROM devices d
    JOIN users u ON u.id = d.user_id
    WHERE d.user_id = ${access.user.id} ${onlyAllowed}
    ORDER BY d.created_at, d.id
  `);
  return result.rows;
}
