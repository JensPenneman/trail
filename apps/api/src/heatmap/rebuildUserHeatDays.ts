import { eq } from "drizzle-orm";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { lockDeviceProcessing } from "../processing/deviceLock";
import { heatCellsRebuilt } from "./heatGeneration";
import { rebuildHeatDays } from "./rebuildHeatDays";

/**
 * Rebuilds the per-day heat cells of all of a user's devices in their (new) time zone
 * (docs/architecture.md §8.2): a device at a time, each in a transaction under the device's
 * processing lock, so no pass writes days in the old zone meanwhile. The cells' ETags move with
 * `heatCellsRebuilt` once each is committed.
 */
export async function rebuildUserHeatDays(
  db: Database,
  userId: string,
  timezone: string,
): Promise<void> {
  const owned = await db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId));
  for (const device of owned) {
    await db.transaction(async (tx) => {
      await allowLongStatements(tx);
      await lockDeviceProcessing(tx, device.id);
      await rebuildHeatDays(tx, device.id, timezone, "all");
    });
    heatCellsRebuilt();
  }
}
