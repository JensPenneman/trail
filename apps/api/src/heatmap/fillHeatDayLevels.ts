import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
import { lockDeviceProcessing } from "../processing/deviceLock";
import { heatDayZooms } from "./heatDayLevels";
import { heatCellsRebuilt } from "./heatGeneration";
import { levelsToRebuild } from "./levelsToRebuild";
import { rebuildHeatDays } from "./rebuildHeatDays";

/**
 * The levels are compared over the last days only (the index on `(device_id, day)` serves it): a
 * scan of every row of every device would read some half a million a device over three years at
 * each start. A level missing older days is made whole by `trail recompute`.
 */
const recentDays = 90;

interface TotalRow extends Record<string, unknown> {
  device_id: string;
  timezone: string;
  z: number;
  total: string | number;
}

/**
 * Brings the per-day heat cells in line with themselves at every start (docs/architecture.md §8.2,
 * §10), as `fillHeatLevels` does the all-time cells: a level of `heat_days` that holds fewer
 * points than the device's fullest (one an older release lacked, one that lost rows) is made
 * again with the others — the device's days, in a transaction under its processing lock — and the
 * heatmap's ETags move (`heatCellsRebuilt`) once it has committed. Days that have no rows at all
 * are the features backfill's (`featureBackfill.ts`). Returns how many devices were rebuilt and
 * whether every device is done.
 */
export async function fillHeatDayLevels(
  db: Database,
  logger: Logger,
  signal?: AbortSignal,
): Promise<{ devices: number; complete: boolean }> {
  const totals = await db.execute<TotalRow>(sql`
    SELECT h.device_id, u.timezone, h.z, sum(h.points) AS total
    FROM heat_days h
    JOIN devices d ON d.id = h.device_id
    JOIN users u ON u.id = d.user_id
    WHERE h.day >= (current_date - ${recentDays}::int)
    GROUP BY h.device_id, u.timezone, h.z, d.created_at
    ORDER BY d.created_at, h.device_id
  `);
  const byDevice = new Map<string, { timezone: string; levels: Map<number, number> }>();
  for (const row of totals.rows) {
    const entry = byDevice.get(row.device_id) ?? { timezone: row.timezone, levels: new Map() };
    entry.levels.set(Number(row.z), Number(row.total));
    byDevice.set(row.device_id, entry);
  }
  let devices = 0;
  for (const [deviceId, { timezone, levels }] of byDevice) {
    if (levelsToRebuild(levels, heatDayZooms).length === 0) continue;
    if (signal?.aborted === true) return { devices, complete: false };
    const started = performance.now();
    await db.transaction(async (tx) => {
      await allowLongStatements(tx);
      await lockDeviceProcessing(tx, deviceId);
      await rebuildHeatDays(tx, deviceId, timezone, "all");
    });
    heatCellsRebuilt();
    devices += 1;
    logger.info(
      { deviceId, durationMs: Math.round(performance.now() - started) },
      "heat days filled in",
    );
  }
  return { devices, complete: true };
}
