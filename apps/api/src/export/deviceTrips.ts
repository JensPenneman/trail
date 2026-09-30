import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { ExportTrip } from "./exportTrip";

/** A device's finished trips that started in `[from, to)`, oldest first (few: read in one go). */
export async function deviceTrips(
  db: Executor,
  deviceId: string,
  range: { from: Date; to: Date },
): Promise<ExportTrip[]> {
  const result = await db.execute<ExportTrip>(sql`
    SELECT started_at, ended_at, mode, distance_m, duration_s, steps, stopped_automatically,
      start_location, end_location, extra
    FROM trips
    WHERE device_id = ${deviceId}
      AND started_at >= ${range.from.toISOString()}::timestamptz
      AND started_at < ${range.to.toISOString()}::timestamptz
    ORDER BY started_at
  `);
  return result.rows;
}
