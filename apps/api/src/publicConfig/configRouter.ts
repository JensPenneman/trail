import { apiPaths } from "@trail/contracts/apiPaths";
import type { PublicConfig } from "@trail/contracts/config";
import express, { type Router } from "express";
import type { Basemap } from "../basemap/basemap";
import type { Config } from "../config/config";
import { requestOrigin } from "../http/requestOrigin";

/** The self-hosted styles' URLs on `origin`, absolute (docs/design/self-hosted-maps.md §3.3). */
const ownStylesOf = (origin: string) => ({
  light: new URL("/map/styles/light.json", origin).href,
  dark: new URL("/map/styles/dark.json", origin).href,
});

/**
 * `GET /api/config` — public runtime configuration for the web app (no
 * secrets). The map's styles follow the basemap: Trail's own while it serves
 * one, the external ones (`MAP_STYLE_LIGHT`, `MAP_STYLE_DARK`) for
 * `MAP_BASEMAP=openfreemap` and as the fallback, the plain ground's paths
 * otherwise.
 */
export function configRouter(config: Config, basemap: Pick<Basemap, "source">): Router {
  const router = express.Router();
  const body: Omit<PublicConfig, "mapStyles"> = {
    appName: "Trail",
    version: config.build.version,
    commit: config.build.commit,
    builtAt: config.build.builtAt,
    publicUrl: config.publicUrl,
    ingestUrl: config.ingestUrl,
    ingestUrls: { ...config.ingestUrls },
    thresholds: { liveMinutes: config.liveWindowMinutes, staleHours: config.staleAfterHours },
    features: { alerts: config.alerts !== null },
  };
  const satellite =
    config.mapStyles.satellite === null ? {} : { satellite: config.mapStyles.satellite };

  router.get(apiPaths.config, (req, res) => {
    const source = basemap.source();
    const styles =
      source === "external"
        ? { light: config.mapStyles.light, dark: config.mapStyles.dark }
        : ownStylesOf(requestOrigin(req, config.allowedOrigins, config.publicUrl));
    res.json({
      ...body,
      mapStyles: { ...styles, ...satellite, basemap: source },
    } satisfies PublicConfig);
  });

  return router;
}
