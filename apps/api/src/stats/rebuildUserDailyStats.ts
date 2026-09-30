import { eq } from "drizzle-orm";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import { rebuildDailyStats } from "./rebuildDailyStats";

/** Rebuilds the daily statistics of all of a user's devices in their current time zone. */
export async function rebuildUserDailyStats(db: Database, userId: string): Promise<void> {
  const owned = await db
    .select({ id: devices.id, timezone: users.timezone })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(eq(devices.userId, userId));
  for (const device of owned) {
    await db.transaction(async (tx) => {
      await allowLongStatements(tx);
      await rebuildDailyStats(tx, device.id, device.timezone);
    });
  }
}
