import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppContext } from "../appContext";
import { rateLimitLogger } from "../http/rateLimitLogger";
import { ingestDeviceOf } from "./ingestDevice";
import { sendIngestError } from "./sendIngestError";

/**
 * Accepted uploads per device token and minute, behind `requireIngestDevice`.
 * Over the limit the phone gets `status` with a `Retry-After`: 429 where every
 * app keeps the upload and tries again, 503 where an app would drop it on a
 * 4xx (OwnTracks for iOS does).
 */
export function perDeviceLimit(
  ctx: AppContext,
  options: { limit: number; status: 429 | 503; identifier: string },
): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: options.limit,
    keyGenerator: (req) => `device:${ingestDeviceOf(req).id}`,
    identifier: options.identifier,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    logger: rateLimitLogger(ctx.logger),
    handler: (_req, res) => {
      sendIngestError(res, options.status, "Too many requests — try again in a minute");
    },
  });
}
