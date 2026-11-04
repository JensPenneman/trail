import { asc, eq } from "drizzle-orm";
import { allowLongStatements } from "../../db/allowLongStatements";
import { devices } from "../../db/schema/devices";
import { users } from "../../db/schema/users";
import { rebuildHeatCells } from "../../heatmap/rebuildHeatCells";
import { rebuildHeatDays } from "../../heatmap/rebuildHeatDays";
import { isUuid } from "../../lib/isUuid";
import { lockDeviceProcessing } from "../../processing/deviceLock";
import { rebuildDailyStats } from "../../stats/rebuildDailyStats";
import type { CliContext } from "../cliContext";
import { UsageError } from "../usageError";

/** `trail recompute [--device <id>]` — rebuilds derived data from the stored points. */
export async function recomputeCommand(
  ctx: CliContext,
  deviceOption: string | undefined,
): Promise<void> {
  if (deviceOption !== undefined && !isUuid(deviceOption)) {
    throw new UsageError("--device must be a device id (a UUID, shown in the device's URL)");
  }
  const query = ctx.db
    .select({ id: devices.id, name: devices.name, timezone: users.timezone })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId));
  const targets = await (deviceOption === undefined
    ? query.orderBy(asc(devices.createdAt))
    : query.where(eq(devices.id, deviceOption)));
  if (targets.length === 0) {
    if (deviceOption !== undefined) throw new Error(`No device with id ${deviceOption}`);
    console.log("No devices yet: nothing to recompute.");
    return;
  }
  for (const device of targets) {
    // The heat cells under the device's lock, which uploads of the device wait for; the
    // statistics after it, without it: they take longer, and uploads would run out of time.
    await ctx.db.transaction((tx) => rebuildHeatCells(tx, device.id));
    // The per-day cells under the device's processing lock, like a pass writes them.
    await ctx.db.transaction(async (tx) => {
      await allowLongStatements(tx);
      await lockDeviceProcessing(tx, device.id);
      await rebuildHeatDays(tx, device.id, device.timezone, "all");
    });
    const days = await ctx.db.transaction((tx) =>
      rebuildDailyStats(tx, device.id, device.timezone),
    );
    console.log(`${device.name} (${device.id}): heat cells rebuilt, ${days} days of statistics`);
  }
}
