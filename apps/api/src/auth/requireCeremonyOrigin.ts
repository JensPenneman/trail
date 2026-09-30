import type { Request } from "express";
import { HttpError } from "../http/httpError";
import { type CeremonyOrigin, ceremonyOriginFor } from "./originPolicy";

/** The request's allowed origin + RP ID, or 403 `origin_not_allowed`. */
export function requireCeremonyOrigin(
  req: Request,
  allowedOrigins: readonly string[],
): CeremonyOrigin {
  const ceremonyOrigin = ceremonyOriginFor(req.get("origin"), allowedOrigins);
  if (ceremonyOrigin === null) {
    throw new HttpError(
      403,
      "origin_not_allowed",
      "Passkeys cannot be used from this address. Open Trail at its configured address.",
    );
  }
  return ceremonyOrigin;
}
