import type { Request } from "express";
import { basicPassword, bearerCredential, isDeviceToken } from "../ingest/deviceToken";

/**
 * OwnTracks' device token: the password of HTTP Basic authentication (any user
 * name) — both apps send it — or `Authorization: Bearer …`, which the iOS app
 * can send as a custom header. Read from the header only, before the body.
 */
export function owntracksToken(req: Request): string | null {
  const header = req.get("authorization");
  const token = bearerCredential(header) ?? basicPassword(header);
  return isDeviceToken(token) ? token : null;
}
