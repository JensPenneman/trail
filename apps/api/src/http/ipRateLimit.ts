import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { Logger } from "pino";
import { HttpError } from "./httpError";
import { rateLimitLogger } from "./rateLimitLogger";
import { sendApiError } from "./sendApiError";

/** Per-IP limiter for the API; over the limit → 429 `rate_limited` (contract error body). */
export function ipRateLimit(options: {
  limit: number;
  windowMs: number;
  logger: Logger;
  /** The policy's name in the `RateLimit` headers (default `<limit>-in-<window>`). */
  identifier?: string;
}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    ...(options.identifier === undefined ? {} : { identifier: options.identifier }),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    logger: rateLimitLogger(options.logger),
    handler: (_req, res) => {
      sendApiError(
        res,
        new HttpError(429, "rate_limited", "Too many requests. Wait a moment and try again."),
      );
    },
  });
}
