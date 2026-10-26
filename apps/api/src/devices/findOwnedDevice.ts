import { and, eq } from "drizzle-orm";
import type { Executor } from "../db/database";
import { devices } from "../db/schema/devices";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { type DeviceAccess, mayReach } from "./deviceAccess";

export type DeviceRow = typeof devices.$inferSelect;

/**
 * A device the principal may reach; unknown, malformed, foreign and — for a
 * token limited to other devices — withheld ids are all 404 (no probing).
 */
export async function findOwnedDevice(
  db: Executor,
  access: DeviceAccess,
  deviceId: string,
): Promise<DeviceRow> {
  if (!isUuid(deviceId) || !mayReach(access, deviceId)) throw notFound("No such device.");
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, access.user.id)))
    .limit(1);
  if (device === undefined) throw notFound("No such device.");
  return device;
}
