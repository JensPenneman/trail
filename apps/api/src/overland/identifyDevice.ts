import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import { hashToken } from "../lib/hashToken";
import { extractDeviceToken } from "./extractDeviceToken";
import { setIngestDevice } from "./ingestDevice";

/**
 * Resolves the bearer device token to its device (SHA-256 lookup) without
 * answering: `requireIngestDevice` turns an unknown token into a 401 after the
 * failed-token limiter has counted it.
 */
export function identifyDevice(db: Database): RequestHandler {
  return async (req, _res, next) => {
    const token = extractDeviceToken(req);
    if (token === null) {
      next();
      return;
    }
    const [device] = await db
      .select({
        id: devices.id,
        name: devices.name,
        userId: devices.userId,
        ownerName: users.displayName,
        timezone: users.timezone,
      })
      .from(devices)
      .innerJoin(users, eq(users.id, devices.userId))
      .where(eq(devices.tokenHash, hashToken(token)))
      .limit(1);
    if (device !== undefined) setIngestDevice(req, device);
    next();
  };
}
