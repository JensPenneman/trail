import { apiPaths } from "@trail/contracts/apiPaths";
import express, { type Express } from "express";
import { adminRouter } from "../admin/adminRouter";
import { apiReferenceRouter } from "../apiReference/apiReferenceRouter";
import type { AppContext } from "../appContext";
import { authRouter } from "../auth/authRouter";
import { loadSession } from "../auth/loadSession";
import { devicesRouter } from "../devices/devicesRouter";
import { eventsRouter } from "../events/eventsRouter";
import { exportRouter } from "../export/exportRouter";
import { healthRouter } from "../health/healthRouter";
import { heatmapRouter } from "../heatmap/heatmapRouter";
import { tripsRouter } from "../history/tripsRouter";
import { visitsRouter } from "../history/visitsRouter";
import { locationsRouter } from "../locations/locationsRouter";
import { apiTokensRouter } from "../me/apiTokensRouter";
import { meRouter } from "../me/meRouter";
import { passkeyLinksRouter } from "../me/passkeyLinksRouter";
import { passkeysRouter } from "../me/passkeysRouter";
import { sessionsRouter } from "../me/sessionsRouter";
import { overlandRouter } from "../overland/overlandRouter";
import { apiReferenceScriptPath } from "../packagedFiles";
import { configRouter } from "../publicConfig/configRouter";
import { linkPageHeaders } from "../sharing/linkPageHeaders";
import { publicSharesRouter } from "../sharing/publicSharesRouter";
import { statsRouter } from "../stats/statsRouter";
import { tracksRouter } from "../tracks/tracksRouter";
import { createV1Router } from "../v1/createV1Router";
import { corsHeaders } from "../v1/v1Cors";
import { apiNotFound } from "./apiNotFound";
import { compress } from "./compress";
import { csrfGuard } from "./csrfGuard";
import { createErrorHandler } from "./errorHandler";
import { ipRateLimit } from "./ipRateLimit";
import { noStore } from "./noStore";
import { pageNotFound } from "./pageNotFound";
import { requestLogger } from "./requestLogger";
import { securityHeaders } from "./securityHeaders";
import { spaRouter } from "./spaRouter";

/**
 * The Express application. Order matters: the Overland ingest is mounted
 * before cookies, CSRF checks and the 100 kB JSON parser; health and config
 * before the rate limiter; the public API (`/api/v1`) before the dashboard's
 * `/api` chain, as it sets its own order; unknown `/api` paths never fall
 * through to the SPA, and neither does `/docs`.
 */
export function createApp(ctx: AppContext): Express {
  const { config, logger } = ctx;
  const app = express();
  app.disable("x-powered-by");
  // API bodies are never cached (no-store), so hashing them for an ETag is wasted work.
  app.set("etag", false);
  app.set("trust proxy", config.trustProxy);

  app.use(requestLogger(logger));
  app.use(securityHeaders(config.mapOrigins));
  app.use(compress());
  app.use("/api", noStore);

  app.use(apiPaths.overland, overlandRouter(ctx));
  app.use(healthRouter(ctx));
  app.use(configRouter(config));

  // Public links: a per-address limit of their own, no session, no CSRF (they only read).
  const publicShareRateLimit = ipRateLimit({
    limit: config.rateLimits.publicSharePerMinute,
    windowMs: 60_000,
    logger,
    identifier: "public-share",
  });
  app.use(
    apiPaths.publicShares.root,
    linkPageHeaders,
    publicShareRateLimit,
    publicSharesRouter(ctx),
  );

  // One per-address budget for the whole API: dashboard, v1 and the reference page.
  const apiRateLimit = ipRateLimit({
    limit: config.rateLimits.apiPerMinute,
    windowMs: 60_000,
    logger,
    identifier: "ip",
  });
  // CORS headers come first, so that a browser client can read even a 429.
  app.use(apiPaths.v1.root, corsHeaders);
  app.use(apiPaths.v1.root, apiRateLimit);
  app.use(apiPaths.v1.root, createV1Router(ctx));

  app.use("/api", apiRateLimit);
  app.use("/api", csrfGuard(config.allowedOrigins));
  app.use("/api", express.json({ limit: "100kb" }));
  app.use("/api", loadSession(ctx.db, config.sessionTtlDays));

  app.use(authRouter(ctx));
  app.use(meRouter(ctx));
  app.use(passkeysRouter(ctx));
  app.use(sessionsRouter(ctx));
  app.use(apiTokensRouter(ctx));
  app.use(passkeyLinksRouter(ctx));
  app.use(adminRouter(ctx));
  app.use(devicesRouter(ctx));
  app.use(tracksRouter(ctx));
  app.use(heatmapRouter(ctx));
  app.use(statsRouter(ctx));
  app.use(visitsRouter(ctx));
  app.use(tripsRouter(ctx));
  app.use(locationsRouter(ctx));
  app.use(exportRouter(ctx));
  app.use(eventsRouter(ctx));
  app.use("/api", apiNotFound);

  const reference = apiReferenceRouter(apiReferenceScriptPath(), logger);
  if (reference !== null) {
    app.use(apiPaths.docs, apiRateLimit);
    app.use(apiPaths.docs, reference);
  }
  app.use(apiPaths.sharePages.root, linkPageHeaders);
  const spa = spaRouter(config.webDistDir, logger);
  if (spa !== null) app.use(spa);
  app.use(pageNotFound);
  app.use(createErrorHandler(logger));
  return app;
}
