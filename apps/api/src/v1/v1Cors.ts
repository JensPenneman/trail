import type { RequestHandler } from "express";

/** What a cross-origin client may send: a token, JSON, a validator and (live events, later) a resume point. */
const allowedHeaders = "Authorization, Content-Type, If-None-Match, Last-Event-ID";

/** What a cross-origin client may read beyond the CORS-safelisted response headers. */
const exposedHeaders =
  "ETag, RateLimit, RateLimit-Policy, Retry-After, WWW-Authenticate, X-Request-Id";

/**
 * CORS headers on every `/api/v1` response, refusals and rate limits included,
 * so a browser client can read why a request failed. Any origin may call the
 * API, but never with credentials: `Access-Control-Allow-Origin: *` does not
 * let a page send or read cookies, so another site reaches v1 with an API
 * token only, never with the visitor's session.
 */
export const corsHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", exposedHeaders);
  next();
};

/**
 * Answers preflight requests (any `OPTIONS`) before authentication and the
 * session: a preflight never carries credentials. `methods` are the ones the
 * route registry uses.
 */
export function corsPreflight(methods: readonly string[]): RequestHandler {
  const allowedMethods = methods.join(", ");
  return (req, res, next) => {
    if (req.method !== "OPTIONS") {
      next();
      return;
    }
    res.setHeader("Access-Control-Allow-Methods", allowedMethods);
    res.setHeader("Access-Control-Allow-Headers", allowedHeaders);
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).end();
  };
}
