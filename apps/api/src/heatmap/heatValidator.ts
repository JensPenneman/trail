import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { heatGeneration } from "./heatGeneration";

interface CounterRow extends Record<string, unknown> {
  total: string;
  updated: string | null;
}

/**
 * What a heatmap answer is made of, read before the cells
 * (docs/architecture.md §8.9): the devices, the sum of their point counters,
 * which every upload and deletion moves, the newest `updated_at` of their
 * rows, which a deletion sets — as many points uploaded as deleted leave the
 * sum where it was, never the cells — and the generation of cells rebuilt at
 * start-up. An upload of points too inaccurate for the cells moves the sum
 * and not the cells — a needless 200, never a wrong 304.
 */
export async function heatValidator(db: Executor, deviceIds: readonly string[]): Promise<unknown> {
  if (deviceIds.length === 0) return [deviceIds, "0", null, heatGeneration()];
  const result = await db.execute<CounterRow>(sql`
    SELECT coalesce(sum(points_total), 0)::text AS total, max(updated_at)::text AS updated
    FROM devices
    WHERE id = ANY(${sql.param(deviceIds)}::uuid[])
  `);
  const row = result.rows[0];
  return [deviceIds, row?.total ?? "0", row?.updated ?? null, heatGeneration()];
}
