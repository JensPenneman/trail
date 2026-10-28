import { remoteSettingsPresetSchema } from "@trail/contracts/remoteSettings";
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
import { invalidTokenMessage, sendIngestError } from "../ingest/sendIngestError";
import { withoutSecrets } from "../ingest/withoutSecrets";
import { extractDeviceToken } from "./extractDeviceToken";
import { isOverlandPayload, type OverlandPayload, payloadShapeError } from "./overlandPayload";
import { presetSettings } from "./overlandPresets";
import { prepareBatch } from "./prepareBatch";

/**
 * `GET/POST /api/overland` — the Overland receiver endpoint (docs/architecture.md
 * §6.4). Mounted before cookies, CSRF checks and the dashboard body parser: it is
 * authenticated by a bearer token and speaks Overland's JSON dialect.
 */
export function overlandRouter(ctx: AppContext): Router {
  const router = express.Router();
  const perDevice = perDeviceLimit(ctx, {
    limit: ctx.config.rateLimits.ingestPerMinute,
    status: 429,
    identifier: "ingest-overland",
  });
  /* Batches of 1000 points are ~600 kB; 5 MB leaves room without inviting abuse.
   * Overland never compresses an upload: a compressed body is refused (415). */
  const json = express.json({ limit: "5mb", inflate: false });
  const authenticated = [
    refuseCredentialsOverHttp(ctx, "overland"),
    identifyDevice(ctx.db, extractDeviceToken),
    failedTokenLimit(ctx),
    requireIngestDevice(),
  ];

  // Overland's account probe, and a handy connectivity test.
  router.get("/", ...authenticated, requireApp("overland"), (req, res) => {
    res.json({ name: ingestDeviceOf(req).name });
  });

  router.post("/", ...authenticated, perDevice, requireApp("overland"), json, async (req, res) => {
    const started = performance.now();
    const device = ingestDeviceOf(req);
    const body: unknown = req.body;
    if (!isOverlandPayload(body)) {
      sendIngestError(res, 400, payloadShapeError);
      return;
    }
    // Before anything reads it: no token a phone sent reaches a column, `extra` or the dead letter.
    const payload = withoutSecrets(body) as OverlandPayload;
    const receivedAt = new Date();
    const outcome = await ingestUpload(ctx.db, device, {
      batch: prepareBatch(payload, receivedAt),
      singles: () =>
        payload.locations.map((record) => ({
          record,
          batch: prepareBatch({ locations: [record] }, receivedAt),
        })),
      receivedAt,
      started,
      userAgent: req.get("user-agent") ?? null,
      deliversSettings: true,
    });
    if (outcome === null) {
      sendIngestError(res, 401, invalidTokenMessage);
      return;
    }
    const preset = remoteSettingsPresetSchema.safeParse(outcome.pendingSettings);
    // Overland drops its queued batch only for exactly this response.
    res.json(
      preset.success ? { result: "ok", set: presetSettings(preset.data) } : { result: "ok" },
    );
    req.log.debug({ deviceId: device.id, ...outcome.counts }, "upload stored");
    afterIngest(ctx, device, outcome);
  });

  router.all("/", (_req, res) => {
    res.setHeader("Allow", "GET, POST");
    sendIngestError(res, 405, "Method not allowed");
  });

  router.use(ingestErrorHandler(ctx.logger));
  return router;
}
