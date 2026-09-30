import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import { hashToken } from "../lib/hashToken";
import { extractDeviceToken } from "./extractDeviceToken";
import { setIngestDevice } from "./ingestDevice";
import { invalidTokenMessage, sendOverlandError } from "./sendOverlandError";

/** Bearer device token → device (SHA-256 lookup); anything else is 401 in Overland's error format. */
export function authenticateDevice(db: Database): RequestHandler {
  return async (req, res, next) => {
    const token = extractDeviceToken(req);
    if (token === null) {
      sendOverlandError(res, 401, invalidTokenMessage);
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
    if (device === undefined) {
      sendOverlandError(res, 401, invalidTokenMessage);
      return;
    }
    setIngestDevice(req, device);
    next();
  };
}
