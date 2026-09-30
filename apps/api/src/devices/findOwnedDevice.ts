import { and, eq } from "drizzle-orm";
import type { Executor } from "../db/database";
import { devices } from "../db/schema/devices";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";

export type DeviceRow = typeof devices.$inferSelect;

/** A device of the user; unknown, malformed and foreign ids are all 404 (no probing). */
export async function findOwnedDevice(
  db: Executor,
  userId: string,
  deviceId: string,
): Promise<DeviceRow> {
  if (!isUuid(deviceId)) throw notFound("No such device.");
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
    .limit(1);
  if (device === undefined) throw notFound("No such device.");
  return device;
}
