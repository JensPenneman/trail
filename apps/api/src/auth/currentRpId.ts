import type { Request } from "express";
import { ceremonyOriginFor } from "./originPolicy";

/**
 * RP ID of the page making the request. GET requests usually carry no Origin
 * header, so the Host (behind a trusted proxy: X-Forwarded-Host) decides then.
 */
export function currentRpId(req: Request, allowedOrigins: readonly string[]): string {
  return ceremonyOriginFor(req.get("origin"), allowedOrigins)?.rpId ?? req.hostname;
}
