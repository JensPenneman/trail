import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { recomputeDailyStats } from "./recomputeDailyStats";

interface DateRow extends Record<string, unknown> {
  date: string;
}

/** Rebuilds every day of one device (CLI `recompute`, time zone change). */
export async function rebuildDailyStats(
  db: Executor,
  deviceId: string,
  timezone: string,
): Promise<number> {
  await db.execute(sql`DELETE FROM daily_stats WHERE device_id = ${deviceId}`);
  const result = await db.execute<DateRow>(sql`
    SELECT DISTINCT (recorded_at AT TIME ZONE ${timezone})::date::text AS date
    FROM locations
    WHERE device_id = ${deviceId}
    ORDER BY 1
  `);
  const dates = result.rows.map((row) => row.date);
  await recomputeDailyStats(db, deviceId, timezone, dates);
  return dates.length;
}
