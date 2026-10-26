import type { RequestHandler } from "express";
import { normaliseOrigin } from "../config/normaliseOrigin";
import { HttpError } from "../http/httpError";
import { sendApiError } from "../http/sendApiError";

/**
 * Whether a request with this `Origin` header may use `/mcp`. Clients that are
 * not browsers send no `Origin`, and pass; a browser always sends one, and it
 * must be one of the allowed origins exactly (scheme, host and port), as the
 * Streamable HTTP transport requires against DNS rebinding. `null` (a
 * sandboxed frame, a file) is never allowed.
 */
export function mcpOriginAllowed(
  originHeader: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (originHeader === undefined) return true;
  const origin = normaliseOrigin(originHeader);
  return origin !== null && allowedOrigins.has(origin);
}

/**
 * Refuses (403 `origin_not_allowed`) a request from a page whose origin is
 * neither one of the instance's own (`PUBLIC_URL`, `ADDITIONAL_ORIGINS`) nor
 * listed in `MCP_ALLOWED_ORIGINS`. It runs before the token is looked up, so
 * a page elsewhere cannot even probe tokens.
 */
export function mcpOriginGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    if (mcpOriginAllowed(req.get("origin"), allowed)) {
      next();
      return;
    }
    sendApiError(
      res,
      new HttpError(403, "origin_not_allowed", "Pages on this origin may not use the MCP server."),
    );
  };
}
