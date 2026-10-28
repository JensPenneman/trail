import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { heatGeneration } from "./heatGeneration";

/**
 * What a heatmap answer is made of, read before the cells
 * (docs/architecture.md §8.9): the devices and the sum of their point
 * counters, which every upload and deletion moves, and the generation of
 * rebuilt cells. An upload of points too inaccurate for the cells moves the
 * sum and not the cells — a needless 200, never a wrong 304.
 */
export async function heatValidator(db: Executor, deviceIds: readonly string[]): Promise<unknown> {
  if (deviceIds.length === 0) return [deviceIds, "0", heatGeneration()];
  const result = await db.execute<{ total: string }>(sql`
    SELECT coalesce(sum(points_total), 0)::text AS total
    FROM devices
    WHERE id = ANY(${sql.param(deviceIds)}::uuid[])
  `);
  return [deviceIds, result.rows[0]?.total ?? "0", heatGeneration()];
}
