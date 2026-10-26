import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppContext } from "../appContext";
import { getRequestAuth } from "../auth/requestAuth";
import { HttpError } from "../http/httpError";
import { rateLimitLogger } from "../http/rateLimitLogger";
import { sendApiError } from "../http/sendApiError";

const limiters = new WeakMap<AppContext, RequestHandler>();

/**
 * Per-token limit of `/api/v1` and `/mcp` (`RATE_LIMIT_TOKEN_PER_MINUTE`), on
 * top of the per-address one: a token used from many addresses, or from both
 * the API and the MCP server, still has one budget — one limiter per app.
 * Session requests are not counted here.
 */
export function tokenRateLimit(ctx: AppContext): RequestHandler {
  const existing = limiters.get(ctx);
  if (existing !== undefined) return existing;
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: ctx.config.rateLimits.tokenPerMinute,
    skip: (req) => getRequestAuth(req)?.kind !== "token",
    keyGenerator: (req) => {
      const auth = getRequestAuth(req);
      return auth?.kind === "token" ? `token:${auth.tokenId}` : "";
    },
    identifier: "token",
    standardHeaders: "draft-8",
    legacyHeaders: false,
    logger: rateLimitLogger(ctx.logger),
    handler: (_req, res) => {
      sendApiError(
        res,
        new HttpError(429, "rate_limited", "Too many requests with this API token. Wait a moment."),
      );
    },
  });
  limiters.set(ctx, limiter);
  return limiter;
}
