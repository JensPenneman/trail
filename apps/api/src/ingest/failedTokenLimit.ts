import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppContext } from "../appContext";
import { rateLimitLogger } from "../http/rateLimitLogger";
import { hasIngestDevice } from "./ingestDevice";
import { sendIngestError } from "./sendIngestError";

const limiters = new WeakMap<AppContext, RequestHandler>();

/**
 * Counts, and refuses, only uploads without a valid device token, per IP — one
 * budget for every ingest endpoint, so a scanner gets no more guesses by trying
 * each of them. Guessing gets slow, while a phone with its valid token is never
 * locked out by a scanner that shares its address (behind NAT or a proxy every
 * client can have the same one). One instance per app.
 */
export function failedTokenLimit(ctx: AppContext): RequestHandler {
  const existing = limiters.get(ctx);
  if (existing !== undefined) return existing;
  const limiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: ctx.config.rateLimits.ingestFailedPer10Minutes,
    skip: hasIngestDevice,
    identifier: "ingest-failed",
    standardHeaders: "draft-8",
    legacyHeaders: false,
    logger: rateLimitLogger(ctx.logger),
    handler: (_req, res) => {
      sendIngestError(res, 429, "Too many requests — try again in a minute");
    },
  });
  limiters.set(ctx, limiter);
  return limiter;
}
