import { eq } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import { hashToken } from "../lib/hashToken";
import { setIngestDevice } from "./ingestDevice";

/**
 * Resolves the device token that `tokenOf` finds in the request (already
 * shape-checked: anything else is null and costs no lookup) to its device,
 * SHA-256 against `devices.token_hash`, without answering:
 * `requireIngestDevice` turns an unknown token into a 401 after the
 * failed-token limiter has counted it.
 */
export function identifyDevice(
  db: Database,
  tokenOf: (req: Request) => string | null,
): RequestHandler {
  return async (req, _res, next) => {
    const token = tokenOf(req);
    if (token === null) {
      next();
      return;
    }
    const [device] = await db
      .select({
        id: devices.id,
        name: devices.name,
        app: devices.source,
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
