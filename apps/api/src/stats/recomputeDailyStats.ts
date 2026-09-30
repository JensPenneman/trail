import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { trackDistance } from "../tracks/distanceAccumulator";

/** Daily distance uses only reasonably accurate points (docs/architecture.md §8.1). */
const distanceMaxAccuracy = 100;

interface DayPointRow extends Record<string, unknown> {
  recorded_at: string;
  epoch: number;
  lat: number;
  lon: number;
  horizontal_accuracy: number | null;
}

/**
 * Rebuilds `daily_stats` rows of one device for local calendar days in the
 * owner's time zone: points, jitter-suppressed distance, first/last point. A
 * day without points loses its row.
 */
export async function recomputeDailyStats(
  db: Executor,
  deviceId: string,
  timezone: string,
  dates: readonly string[],
): Promise<void> {
  for (const date of dates) {
    const result = await db.execute<DayPointRow>(sql`
      SELECT recorded_at, extract(epoch FROM recorded_at)::float8 AS epoch, lat, lon,
        horizontal_accuracy
      FROM locations
      WHERE device_id = ${deviceId}
        AND recorded_at >= (${date}::date)::timestamp AT TIME ZONE ${timezone}
        AND recorded_at < (${date}::date + 1)::timestamp AT TIME ZONE ${timezone}
      ORDER BY recorded_at
    `);
    const rows = result.rows;
    const first = rows[0];
    const last = rows.at(-1);
    if (first === undefined || last === undefined) {
      await db.execute(
        sql`DELETE FROM daily_stats WHERE device_id = ${deviceId} AND date = ${date}::date`,
      );
      continue;
    }
    const distanceM = trackDistance(
      rows
        .filter(
          (row) =>
            row.horizontal_accuracy === null || row.horizontal_accuracy <= distanceMaxAccuracy,
        )
        .map((row) => ({
          lat: row.lat,
          lon: row.lon,
          t: row.epoch,
          accuracy: row.horizontal_accuracy,
        })),
    );
    await db.execute(sql`
      INSERT INTO daily_stats (device_id, date, points, distance_m, first_at, last_at)
      VALUES (${deviceId}, ${date}::date, ${rows.length}, ${Math.round(distanceM * 10) / 10},
        ${toIso(first.recorded_at)}::timestamptz, ${toIso(last.recorded_at)}::timestamptz)
      ON CONFLICT (device_id, date) DO UPDATE SET
        points = excluded.points,
        distance_m = excluded.distance_m,
        first_at = excluded.first_at,
        last_at = excluded.last_at
    `);
  }
}
