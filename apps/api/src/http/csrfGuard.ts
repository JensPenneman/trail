import type { Request, RequestHandler } from "express";
import { normaliseOrigin } from "../config/normaliseOrigin";
import { HttpError } from "./httpError";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const hasBody = (req: Request): boolean => {
  if (req.headers["transfer-encoding"] !== undefined) return true;
  const length = Number(req.headers["content-length"] ?? "0");
  return Number.isFinite(length) && length > 0;
};

/**
 * CSRF defence for cookie-authenticated routes (docs/architecture.md §7): every
 * unsafe request must come from an allowed origin, from the same site when the
 * browser says so, and carry JSON if it has a body — a cross-site form post can
 * satisfy none of these. The Overland ingest (bearer token, no cookies) is
 * mounted before this guard.
 */
export function csrfGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (safeMethods.has(req.method)) {
      next();
      return;
    }
    const origin = normaliseOrigin(req.get("origin") ?? "");
    if (origin === null || !allowed.has(origin)) {
      throw new HttpError(403, "origin_not_allowed", "This origin may not use the API.");
    }
    const site = req.get("sec-fetch-site");
    if (site !== undefined && site !== "same-origin") {
      throw new HttpError(403, "origin_not_allowed", "Cross-site requests are not allowed.");
    }
    if (hasBody(req) && req.is(["application/json", "application/*+json"]) === false) {
      throw new HttpError(415, "bad_request", "Send the request body as application/json.");
    }
    next();
  };
}
