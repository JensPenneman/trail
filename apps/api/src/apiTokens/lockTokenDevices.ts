import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "../db/database";
import { devices } from "../db/schema/devices";
import { notFound } from "../http/httpError";

/**
 * Checks that the user owns every device a token is to be limited to, and
 * holds them until the transaction ends: a device deleted meanwhile cannot
 * slip into the token's list after its deletion has cleaned the lists up.
 * Foreign and unknown ids are 404, as everywhere.
 */
export async function lockTokenDevices(
  tx: Transaction,
  userId: string,
  deviceIds: readonly string[] | null,
): Promise<void> {
  if (deviceIds === null || deviceIds.length === 0) return;
  const owned = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, userId), inArray(devices.id, [...deviceIds])))
    .for("key share");
  if (owned.length !== new Set(deviceIds).size) throw notFound("No such device.");
}
