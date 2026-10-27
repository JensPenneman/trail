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
import {
  basicChallenge,
  bearerChallenge,
  invalidTokenMessage,
  sendIngestError,
} from "../ingest/sendIngestError";
import { owntracksToken } from "./owntracksToken";
import { prepareOwnTracks } from "./prepareOwnTracks";
import { readOwnTracksBody } from "./readOwnTracksBody";

const challenges = [basicChallenge, bearerChallenge];

/**
 * `POST /api/owntracks` — OwnTracks in HTTP mode (docs/architecture.md §6.5):
 * one JSON message per request, the device token as HTTP Basic password (over
 * HTTPS only) or bearer token, checked before the body is read. Every
 * accepted request is answered `200 []`, the empty list of messages the apps
 * expect back. Over the per-device limit the answer is 503, never a 4xx:
 * OwnTracks for iOS drops a message that gets a 4xx.
 */
export function owntracksRouter(ctx: AppContext): Router {
  const router = express.Router();
  const perDevice = perDeviceLimit(ctx, {
    limit: ctx.config.rateLimits.ingestSinglePerMinute,
    status: 503,
    identifier: "ingest-owntracks",
  });
  // A message is a few hundred bytes; a point of interest's photo (192 px) some kilobytes.
  const body = express.raw({ type: () => true, limit: "1mb" });

  router.post(
    "/",
    refuseBasicOverHttp,
    identifyDevice(ctx.db, owntracksToken),
    failedTokenLimit(ctx),
    requireIngestDevice(challenges),
    perDevice,
    requireApp("owntracks"),
    body,
    async (req, res) => {
      const started = performance.now();
      const device = ingestDeviceOf(req);
      const receivedAt = new Date();
      const prepared = prepareOwnTracks(readOwnTracksBody(req.body), receivedAt);
      const outcome = await ingestUpload(ctx.db, device, {
        batch: prepared.batch,
        singles: () => [{ record: prepared.record, batch: prepared.batch }],
        receivedAt,
        started,
        userAgent: req.get("user-agent") ?? null,
        deliversSettings: false,
      });
      if (outcome === null) {
        sendIngestError(res, 401, invalidTokenMessage, challenges);
        return;
      }
      // No friends, cards or commands for the phone: Trail only records.
      res.json([]);
      req.log.debug({ deviceId: device.id, ...outcome.counts }, "upload stored");
      afterIngest(ctx, device, outcome);
    },
  );

  router.all("/", (_req, res) => {
    res.setHeader("Allow", "POST");
    sendIngestError(res, 405, "Method not allowed");
  });

  router.use(ingestErrorHandler(ctx.logger));
  return router;
}
