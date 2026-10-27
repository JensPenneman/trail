import type { Request } from "express";
import { bearerCredential, isDeviceToken } from "../ingest/deviceToken";

/**
 * Overland's device token: `Authorization: Bearer …`, or `?token=` /
 * `?access_token=` for clients that cannot set headers. Anything not shaped
 * like a Trail token is treated as missing, which saves a database lookup.
 */
export function extractDeviceToken(req: Request): string | null {
  const bearer = bearerCredential(req.get("authorization"));
  const fromQuery = [req.query["token"], req.query["access_token"]].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const token = bearer ?? fromQuery ?? null;
  return isDeviceToken(token) ? token : null;
}
