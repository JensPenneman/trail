import { remoteSettingsPresetSchema } from "@trail/contracts/remoteSettings";
import express, { type Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppContext } from "../appContext";
import { rateLimitLogger } from "../http/rateLimitLogger";
import { afterIngest } from "./afterIngest";
import { authenticateDevice } from "./authenticateDevice";
import { ingestDeviceOf } from "./ingestDevice";
import { ingestUpload } from "./ingestUpload";
import { overlandErrorHandler } from "./overlandErrorHandler";
import { isOverlandPayload, payloadShapeError } from "./overlandPayload";
import { presetSettings } from "./overlandPresets";
import { invalidTokenMessage, sendOverlandError } from "./sendOverlandError";

/**
 * `GET/POST /api/overland` — the Overland receiver endpoint (docs/architecture.md
 * §6). Mounted before cookies, CSRF checks and the dashboard body parser: it is
 * authenticated by a bearer token and speaks Overland's JSON dialect.
 */
export function overlandRouter(ctx: AppContext): Router {
  const router = express.Router();
  const limits = ctx.config.rateLimits;
  const tooMany = (_req: express.Request, res: express.Response) => {
    sendOverlandError(res, 429, "Too many requests — try again in a minute");
  };

  // Counts only rejected tokens, per IP: guessing tokens gets slow, phones are unaffected.
  const failedTokens = rateLimit({
    windowMs: 10 * 60_000,
    limit: limits.ingestFailedPer10Minutes,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    logger: rateLimitLogger(ctx.logger),
    handler: tooMany,
  });
  const perDevice = rateLimit({
    windowMs: 60_000,
    limit: limits.ingestPerMinute,
    keyGenerator: (req) => `device:${ingestDeviceOf(req).id}`,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    logger: rateLimitLogger(ctx.logger),
    handler: tooMany,
  });
  // Batches of 1000 points are ~600 kB; 5 MB leaves room without inviting abuse.
  const json = express.json({ limit: "5mb" });

  // Overland's account probe, and a handy connectivity test.
  router.get("/", failedTokens, authenticateDevice(ctx.db), (req, res) => {
    res.json({ name: ingestDeviceOf(req).name });
  });

  router.post("/", failedTokens, authenticateDevice(ctx.db), perDevice, json, async (req, res) => {
    const device = ingestDeviceOf(req);
    if (!isOverlandPayload(req.body)) {
      sendOverlandError(res, 400, payloadShapeError);
      return;
    }
    const outcome = await ingestUpload(ctx.db, device, req.body, req.get("user-agent") ?? null);
    if (outcome === null) {
      sendOverlandError(res, 401, invalidTokenMessage);
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
    sendOverlandError(res, 405, "Method not allowed");
  });

  router.use(overlandErrorHandler(ctx.logger));
  return router;
}
