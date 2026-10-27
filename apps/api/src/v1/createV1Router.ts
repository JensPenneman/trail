import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { loadSession } from "../auth/loadSession";
import { getRequestAuth } from "../auth/requestAuth";
import { apiNotFound } from "../http/apiNotFound";
import { csrfGuard } from "../http/csrfGuard";
import { sameOriginSessions } from "../http/sameOriginSessions";
import { authenticateBearer } from "./authenticateBearer";
import type { V1Route } from "./defineRoute";
import { buildOpenApiDocument } from "./openapi/buildOpenApiDocument";
import { readApiGuide } from "./openapi/readApiGuide";
import { type ServedDocument, serveDocument } from "./openapi/servedDocument";
import { tokenRateLimit } from "./tokenRateLimit";
import { corsPreflight } from "./v1Cors";
import { v1Routes } from "./v1Routes";

/** Two routes with one operationId or one method and path are a mistake: refuse to start. */
function checkUnique(routes: readonly V1Route[]): void {
  const seen = new Set<string>();
  for (const { spec } of routes) {
    for (const key of [spec.operationId, `${spec.method} ${spec.path}`]) {
      if (seen.has(key)) throw new Error(`Two /api/v1 routes share ${key}`);
      seen.add(key);
    }
  }
}

const isPublic = (route: V1Route): boolean => route.spec.auth === "public";

/**
 * The public API, mounted at `/api/v1` before the dashboard's `/api` chain so it
 * sets its own order (docs/architecture.md §8.3). `createApp` puts the CORS
 * headers and the per-IP limiter it shares with the dashboard API in front;
 * then come the preflight → API token → per-token limit → the public routes →
 * session (only without a token) → no session from another site → CSRF guard
 * (only without a token) → JSON body → the other routes of the registry →
 * JSON 404. The OpenAPI document is
 * built here, once, so a spec it cannot describe stops the server at startup.
 */
export function createV1Router(ctx: AppContext): Router {
  const { config } = ctx;
  let served: ServedDocument | undefined;
  const routes = v1Routes(() => {
    if (served === undefined) throw new Error("The OpenAPI document is not built yet");
    return served;
  });
  checkUnique(routes);
  served = serveDocument(
    buildOpenApiDocument(
      { publicUrl: config.publicUrl, version: config.build.version, guide: readApiGuide() },
      routes,
    ),
  );

  const session = loadSession(ctx.db, config.sessionTtlDays);
  const csrf = csrfGuard(config.allowedOrigins);
  const methods = [...new Set(routes.map(({ spec }) => spec.method.toUpperCase()))];

  const router = express.Router();
  const mount = (route: V1Route): void => {
    router.route(route.expressPath)[route.spec.method]((req, res) => route.handle(ctx, req, res));
  };
  router.use(corsPreflight(methods));
  router.use(authenticateBearer(ctx));
  router.use(tokenRateLimit(ctx));
  // Public routes never load the session: their answers may be cached by anyone (the
  // OpenAPI document is), and the session's sliding refresh, or the clearing of a stale
  // cookie, must not reach whoever a shared cache serves next.
  for (const route of routes.filter(isPublic)) mount(route);
  // A bearer request is decided by its token: the session cookie stays unread.
  router.use((req, res, next) =>
    getRequestAuth(req) === undefined ? session(req, res, next) : next(),
  );
  // A session works from Trail's own pages only, for every method (a GET too).
  router.use(sameOriginSessions);
  // A token is no ambient credential, so CSRF cannot forge it; everything else is guarded.
  router.use((req, res, next) =>
    getRequestAuth(req)?.kind === "token" ? next() : csrf(req, res, next),
  );
  router.use(express.json({ limit: "100kb", type: ["application/json", "application/*+json"] }));
  for (const route of routes.filter((candidate) => !isPublic(candidate))) mount(route);
  router.use(apiNotFound);
  return router;
}
