import type { Request } from "express";
import { basicPassword, bearerCredential, isDeviceToken } from "../ingest/deviceToken";
import { asRecord } from "../ingest/ingestValues";
import { osmandRequestOf } from "./osmandRequest";

/** Parameters that carry the device token: `token` for clients that can set it, `id` for those that cannot. */
export const tokenParameters = ["token", "access_token", "id", "deviceid"] as const;

/**
 * The device token of an OsmAnd-format request, the first token-shaped one of:
 * `Authorization: Bearer …` (GPSLogger), the HTTP Basic password (over HTTPS
 * only), the `token` / `access_token` parameter (OsmAnd), the device
 * identifier `id` / `deviceid` (Traccar Client sends nothing else) and a JSON
 * body's `device_id` (Traccar Client 9).
 */
export function osmandToken(req: Request): string | null {
  const header = req.get("authorization");
  const { params, json } = osmandRequestOf(req);
  const candidates = [
    bearerCredential(header),
    basicPassword(header),
    ...tokenParameters.map((name) => params.get(name)),
    json?.ok === true ? asRecord(json.value)?.["device_id"] : undefined,
  ];
  return candidates.find(isDeviceToken) ?? null;
}
