import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppContext } from "../appContext";
import { rateLimitLogger } from "../http/rateLimitLogger";
import { hasIngestDevice } from "./ingestDevice";
import { sendIngestError } from "./sendIngestError";

const limiters = new WeakMap<AppContext, RequestHandler>();

/**
 * Counts uploads without a valid device token per IP — one budget for every
 * ingest endpoint, so trying each of them earns no more — and answers 429 once
 * an address has used it up. It is consulted after the lookup, so a phone with
 * its valid token is never locked out by a scanner that shares its address
 * (behind NAT or a proxy every client can have the same one); with 256-bit
 * tokens the lookups themselves need no cap. One instance per app.
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
