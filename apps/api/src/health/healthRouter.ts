import { apiPaths } from "@trail/contracts/apiPaths";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { ipRateLimit } from "../http/ipRateLimit";

const databaseCheckTimeoutMs = 2_000;

/**
 * `GET /api/health` (with a database round trip; 503 when it fails) and
 * `GET /api/health/live` (process only — the container health check, which
 * must not flap because Postgres restarts). Both sit before the API's rate
 * limiter so the container health check is never throttled; the database
 * check gets a limiter of its own, or anyone could load Postgres through it.
 */
export function healthRouter(ctx: AppContext): Router {
  const router = express.Router();
  const info = () => ({
    version: ctx.config.build.version,
    commit: ctx.config.build.commit,
    uptimeS: Math.round(process.uptime()),
  });

  router.get(apiPaths.healthLive, (_req, res) => {
    res.json({ status: "ok", ...info() });
  });

  const databaseCheckLimit = ipRateLimit({
    limit: ctx.config.rateLimits.apiPerMinute,
    windowMs: 60_000,
    logger: ctx.logger,
  });

  router.get(apiPaths.health, databaseCheckLimit, async (_req, res) => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("database check timed out")),
        databaseCheckTimeoutMs,
      );
    });
    try {
      await Promise.race([ctx.pool.query("SELECT 1"), timeout]);
      res.json({ status: "ok", db: "ok", ...info() });
    } catch (error) {
      ctx.logger.warn({ err: error }, "health check: database unavailable");
      res.status(503).json({ status: "unavailable", db: "down", ...info() });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
}
