import { apiPaths } from "@trail/contracts/apiPaths";
import type { Health, LiveHealth, ProcessingHealth } from "@trail/contracts/health";
import express, { type Response, type Router } from "express";
import type { AppContext } from "../appContext";
import { ipRateLimit } from "../http/ipRateLimit";
import { readProcessingHealth } from "./readProcessingHealth";

const databaseCheckTimeoutMs = 2_000;

/**
 * `GET /api/health` (a database round trip with the processing summary; 503
 * only when the database fails, so the edge and an uptime monitor see the
 * API's truth whatever the worker does), `GET /api/health/processing` (the
 * same, and 503 also when no worker beat for 90 s: for a monitor of the
 * worker) and `GET /api/health/live` (process only — the container health
 * check, which must not flap because Postgres restarts). All sit before the
 * API's rate limiter so the container health check is never throttled; the
 * two database checks share a limiter of their own, or anyone could load
 * Postgres through them.
 */
export function healthRouter(ctx: AppContext): Router {
  const router = express.Router();
  const info = (): Omit<LiveHealth, "status"> => ({
    version: ctx.config.build.version,
    commit: ctx.config.build.commit,
    uptimeS: Math.round(process.uptime()),
  });

  router.get(apiPaths.healthLive, (_req, res) => {
    res.json({ status: "ok", ...info() } satisfies LiveHealth);
  });

  const databaseCheckLimit = ipRateLimit({
    limit: ctx.config.rateLimits.apiPerMinute,
    windowMs: 60_000,
    logger: ctx.logger,
  });

  /** The processing summary, or null when the database did not answer within 2 s. */
  const check = async (): Promise<ProcessingHealth | null> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("database check timed out")),
        databaseCheckTimeoutMs,
      );
    });
    try {
      return await Promise.race([
        readProcessingHealth(ctx.db, { enabled: ctx.config.processing.enabled }),
        timeout,
      ]);
    } catch (error) {
      ctx.logger.warn({ err: error }, "health check: database unavailable");
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const databaseDown = (res: Response) => {
    res.status(503).json({ status: "unavailable", db: "down", ...info() } satisfies Health);
  };

  router.get(apiPaths.health, databaseCheckLimit, async (_req, res) => {
    const processing = await check();
    if (processing === null) {
      databaseDown(res);
      return;
    }
    res.json({ status: "ok", db: "ok", ...info(), processing } satisfies Health);
  });

  router.get(apiPaths.healthProcessing, databaseCheckLimit, async (_req, res) => {
    const processing = await check();
    if (processing === null) {
      databaseDown(res);
      return;
    }
    const down = processing.worker === "down";
    res.status(down ? 503 : 200).json({
      status: down ? "unavailable" : "ok",
      db: "ok",
      ...info(),
      processing,
    } satisfies Health);
  });

  return router;
}
