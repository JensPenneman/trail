import { and, asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "../db/database";
import { devices } from "../db/schema/devices";
import { notFound } from "../http/httpError";

export interface OwnedDevice {
  id: string;
  name: string;
  deviceKey: string;
}

/**
 * The devices a query is about: the requested ids (every one must belong to the
 * user, otherwise 404) or, when none were given, all of the user's devices.
 */
export async function resolveDeviceIds(
  db: Executor,
  userId: string,
  requested: readonly string[] | undefined,
): Promise<OwnedDevice[]> {
  const columns = { id: devices.id, name: devices.name, deviceKey: devices.deviceKey };
  if (requested === undefined) {
    return db
      .select(columns)
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(asc(devices.createdAt), asc(devices.id));
  }
  const unique = [...new Set(requested)];
  const owned = await db
    .select(columns)
    .from(devices)
    .where(and(eq(devices.userId, userId), inArray(devices.id, unique)))
    .orderBy(asc(devices.createdAt), asc(devices.id));
  if (owned.length !== unique.length) throw notFound("No such device.");
  return owned;
}
