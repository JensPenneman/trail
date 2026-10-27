import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { afterIngest } from "../ingest/afterIngest";
import { failedTokenLimit } from "../ingest/failedTokenLimit";
import { identifyDevice } from "../ingest/identifyDevice";
import { ingestDeviceOf } from "../ingest/ingestDevice";
import { ingestErrorHandler } from "../ingest/ingestErrorHandler";
import { ingestUpload } from "../ingest/ingestUpload";
import { perDeviceLimit } from "../ingest/perDeviceLimit";
import { refuseBasicOverHttp } from "../ingest/refuseBasicOverHttp";
import { requireApp } from "../ingest/requireApp";
import { requireIngestDevice } from "../ingest/requireIngestDevice";
import { invalidTokenMessage, sendIngestError } from "../ingest/sendIngestError";
import { isOsmandApp } from "./osmandApps";
import { isJsonBody, osmandRequestOf, readOsmandRequest } from "./osmandRequest";
import { osmandToken } from "./osmandToken";
import { prepareOsmand } from "./prepareOsmand";

/**
 * `GET/POST /api/osmand` — the OsmAnd format (docs/architecture.md §6.6) that
 * Traccar's server speaks: Traccar Client posts a form, OsmAnd and GPSLogger
 * send their URL templates, Traccar Client 9 posts JSON. Every accepted
 * request is answered `200` with an empty body, which is all these clients
 * look at. The body is read before the token, since Traccar Client puts the
 * token — its device identifier — into the form; bodies stay small.
 */
export function osmandRouter(ctx: AppContext): Router {
  const router = express.Router();
  const perDevice = perDeviceLimit(ctx, {
    limit: ctx.config.rateLimits.ingestSinglePerMinute,
    status: 429,
    identifier: "ingest-osmand",
  });
  /* Traccar Client 9's JSON holds as many points as its plugin had to send (about
   * 500 bytes each, up to 1000); a position's parameters are a few hundred
   * bytes, GPSLogger's every placeholder fits many times in 64 kB. The second
   * parser skips a body the first has read. */
  const jsonBody = express.raw({ type: isJsonBody, limit: "1mb" });
  const body = express.raw({ type: () => true, limit: "64kb" });

  const onlyGetAndPost: express.RequestHandler = (req, res, next) => {
    // Not HEAD: the GET of this format stores what it carries.
    if (req.method === "GET" || req.method === "POST") {
      next();
      return;
    }
    res.setHeader("Allow", "GET, POST");
    sendIngestError(res, 405, "Method not allowed");
  };

  router.all(
    "/",
    onlyGetAndPost,
    refuseBasicOverHttp,
    jsonBody,
    body,
    readOsmandRequest,
    identifyDevice(ctx.db, osmandToken),
    failedTokenLimit(ctx),
    requireIngestDevice(),
    perDevice,
    requireApp("osmand"),
    async (req, res) => {
      const started = performance.now();
      const device = ingestDeviceOf(req);
      if (!isOsmandApp(device.app)) throw new Error("requireApp let another app through");
      const receivedAt = new Date();
      const prepared = prepareOsmand(osmandRequestOf(req), device.app, receivedAt);
      const outcome = await ingestUpload(ctx.db, device, {
        batch: prepared.batch,
        singles: () => prepared.singles,
        receivedAt,
        started,
        userAgent: req.get("user-agent") ?? null,
        deliversSettings: false,
      });
      if (outcome === null) {
        sendIngestError(res, 401, invalidTokenMessage);
        return;
      }
      res.status(200).end();
      req.log.debug({ deviceId: device.id, ...outcome.counts }, "upload stored");
      afterIngest(ctx, device, outcome);
    },
  );

  router.use(ingestErrorHandler(ctx.logger));
  return router;
}
