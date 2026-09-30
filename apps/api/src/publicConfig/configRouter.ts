import { apiPaths } from "@trail/contracts/apiPaths";
import type { PublicConfig } from "@trail/contracts/config";
import express, { type Router } from "express";
import type { Config } from "../config/config";

/** `GET /api/config` — public runtime configuration for the web app (no secrets). */
export function configRouter(config: Config): Router {
  const router = express.Router();
  const body: PublicConfig = {
    appName: "Trail",
    version: config.build.version,
    commit: config.build.commit,
    builtAt: config.build.builtAt,
    publicUrl: config.publicUrl,
    ingestUrl: config.ingestUrl,
    mapStyles: config.mapStyles,
    thresholds: { liveMinutes: config.liveWindowMinutes, staleHours: config.staleAfterHours },
    features: { alerts: config.alerts !== null },
  };

  router.get(apiPaths.config, (_req, res) => {
    res.json(body);
  });

  return router;
}
