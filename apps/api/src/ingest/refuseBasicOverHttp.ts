import type { RequestHandler } from "express";
import { authorizationScheme } from "./deviceToken";
import { sendIngestError } from "./sendIngestError";

/**
 * HTTP Basic carries the device token as a password in every request: it is
 * taken over HTTPS only — TLS to Trail itself, or a trusted proxy's
 * `X-Forwarded-Proto: https` (`TRUST_PROXY`), the same rule that decides the
 * `__Host-` session cookie. Over plain HTTP it is refused before any lookup.
 */
export const refuseBasicOverHttp: RequestHandler = (req, res, next) => {
  if (authorizationScheme(req.get("authorization")) !== "basic" || req.secure) {
    next();
    return;
  }
  sendIngestError(res, 403, "Basic authentication needs HTTPS: use the https:// address of Trail");
};
