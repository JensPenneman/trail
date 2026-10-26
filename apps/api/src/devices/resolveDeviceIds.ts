import { and, asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "../db/database";
import { devices } from "../db/schema/devices";
import { notFound } from "../http/httpError";
import { allowedDeviceIds, type DeviceAccess, mayReach } from "./deviceAccess";

export interface OwnedDevice {
  id: string;
  name: string;
  deviceKey: string;
}

/**
 * The devices a query is about: the requested ids (every one must be reachable
 * by the principal, otherwise 404) or, when none were given, every device the
 * principal may reach.
 */
export async function resolveDeviceIds(
  db: Executor,
  access: DeviceAccess,
  requested: readonly string[] | undefined,
): Promise<OwnedDevice[]> {
  const columns = { id: devices.id, name: devices.name, deviceKey: devices.deviceKey };
  const owner = eq(devices.userId, access.user.id);
  if (requested === undefined) {
    const allowed = allowedDeviceIds(access);
    if (allowed?.length === 0) return [];
    return db
      .select(columns)
      .from(devices)
      .where(allowed === null ? owner : and(owner, inArray(devices.id, [...allowed])))
      .orderBy(asc(devices.createdAt), asc(devices.id));
  }
  const unique = [...new Set(requested)];
  if (!unique.every((deviceId) => mayReach(access, deviceId))) throw notFound("No such device.");
  const owned = await db
    .select(columns)
    .from(devices)
    .where(and(owner, inArray(devices.id, unique)))
    .orderBy(asc(devices.createdAt), asc(devices.id));
  if (owned.length !== unique.length) throw notFound("No such device.");
  return owned;
}
