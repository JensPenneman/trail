import type { Request } from "express";
import { ceremonyOriginFor } from "../auth/originPolicy";

/**
 * The origin a request was made to (`PUBLIC_URL` or one of `ADDITIONAL_ORIGINS`,
 * as `allowedOrigins` lists them), or `fallback` (`PUBLIC_URL`) for any other host.
 */
export function requestOrigin(
  req: Pick<Request, "protocol" | "get">,
  allowedOrigins: readonly string[],
  fallback: string,
): string {
  const host = req.get("host");
  const own = host === undefined ? undefined : `${req.protocol}://${host}`;
  return ceremonyOriginFor(own, allowedOrigins)?.origin ?? fallback;
}
