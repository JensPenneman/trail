import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { ExportVisit } from "./exportVisit";

/**
 * A device's visits recorded in `[from, to)`, by arrival. iOS reports a visit
 * on arrival and again on departure; the two are merged into the one that
 * knows the departure, as the dashboard shows them. Visits are few, so they
 * are read in one go.
 */
export async function deviceVisits(
  db: Executor,
  deviceId: string,
  range: { from: Date; to: Date },
): Promise<ExportVisit[]> {
  const result = await db.execute<ExportVisit>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (coalesce(arrived_at, recorded_at))
        recorded_at, arrived_at, departed_at, lat, lon, horizontal_accuracy, extra
      FROM visits
      WHERE device_id = ${deviceId}
        AND recorded_at >= ${range.from.toISOString()}::timestamptz
        AND recorded_at < ${range.to.toISOString()}::timestamptz
      ORDER BY coalesce(arrived_at, recorded_at), departed_at DESC NULLS LAST, recorded_at DESC
    ) merged
    ORDER BY coalesce(arrived_at, recorded_at)
  `);
  return result.rows;
}
