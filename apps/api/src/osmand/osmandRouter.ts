import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { afterIngest } from "../ingest/afterIngest";
import { failedTokenLimit } from "../ingest/failedTokenLimit";
import { identifyDevice } from "../ingest/identifyDevice";
import { ingestDeviceOf } from "../ingest/ingestDevice";
import { ingestErrorHandler } from "../ingest/ingestErrorHandler";
import { ingestUpload } from "../ingest/ingestUpload";
import { perDeviceLimit } from "../ingest/perDeviceLimit";
import { refuseCredentialsOverHttp } from "../ingest/refuseCredentialsOverHttp";
import { requireApp } from "../ingest/requireApp";
import { requireIngestDevice } from "../ingest/requireIngestDevice";
import {
  basicChallenge,
  bearerChallenge,
  invalidTokenMessage,
  sendIngestError,
} from "../ingest/sendIngestError";
import { isOsmandApp } from "./osmandApps";
import { osmandRequestOf, readOsmandRequest } from "./osmandRequest";
import { osmandToken } from "./osmandToken";
import { prepareOsmand } from "./prepareOsmand";

/** The schemes of the `Authorization` header this endpoint takes, for the 401's challenges. */
const challenges = [bearerChallenge, basicChallenge];

/**
 * `GET/POST /api/osmand` — the OsmAnd format (docs/architecture.md §6.6) that
 * Traccar's server speaks: Traccar Client posts a form, OsmAnd and GPSLogger
 * send their URL templates, Traccar Client 9 posts JSON. Every accepted
 * request is answered `200` with an empty body, which is all these clients
 * look at. Traccar Client puts the token — its device identifier — into the
 * form, so the raw body is read before the lookup, but parsed only as far as
 * the token needs: at most 100 parameters, a JSON body not at all.
 */
export function osmandRouter(ctx: AppContext): Router {
  const router = express.Router();
  const perDevice = perDeviceLimit(ctx, {
    limit: ctx.config.rateLimits.ingestSinglePerMinute,
    status: 429,
    identifier: "ingest-osmand",
  });
  /* A position's parameters, or Traccar Client 9's JSON of one location, are a
   * few hundred bytes; GPSLogger's every placeholder fits many times. No client
   * compresses an upload: a compressed body is refused (415) before it is read. */
  const body = express.raw({ type: () => true, limit: "64kb", inflate: false });

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
    refuseCredentialsOverHttp(ctx.config, "osmand"),
    body,
    readOsmandRequest,
    identifyDevice(ctx.db, osmandToken),
    failedTokenLimit(ctx),
    requireIngestDevice(challenges),
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
        sendIngestError(res, 401, invalidTokenMessage, challenges);
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
