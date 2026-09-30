import { apiPaths } from "@trail/contracts/apiPaths";
import type { SessionResponse } from "@trail/contracts/user";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { ipRateLimit } from "../http/ipRateLimit";
import { routeParam } from "../http/routeParam";
import { finishCeremony } from "./finishCeremony";
import { linkInfo } from "./linkInfo";
import { logout } from "./logout";
import { requireAuth } from "./requestAuth";
import { startAuth } from "./startAuth";
import { startDiscoverableSignIn } from "./startDiscoverableSignIn";
import { startLinkRegistration } from "./startLinkRegistration";
import { toSessionUser } from "./toSessionUser";

/** `/api/auth/*` (docs/architecture.md §7). Every route except the session probe is rate limited per IP. */
export function authRouter(ctx: AppContext): Router {
  const router = express.Router();
  const limited = ipRateLimit({
    limit: ctx.config.rateLimits.authPerMinute,
    windowMs: 60_000,
    logger: ctx.logger,
  });

  router.get(apiPaths.auth.session, (req, res) => {
    const { user } = requireAuth(req);
    const body: SessionResponse = { user: toSessionUser(user) };
    res.json(body);
  });

  router.post(apiPaths.auth.start, limited, async (req, res) => {
    res.json(await startAuth(ctx, req));
  });

  router.post(apiPaths.auth.passkey, limited, async (req, res) => {
    res.json(await startDiscoverableSignIn(ctx, req));
  });

  router.post(apiPaths.auth.finish, limited, async (req, res) => {
    res.json(await finishCeremony(ctx, req, res));
  });

  router.post(apiPaths.auth.logout, limited, async (req, res) => {
    await logout(ctx, req, res);
    res.status(204).end();
  });

  router.get("/api/auth/link/:token", limited, async (req, res) => {
    res.json(await linkInfo(ctx.db, routeParam(req, "token")));
  });

  router.post("/api/auth/link/:token/start", limited, async (req, res) => {
    res.json(await startLinkRegistration(ctx, req, routeParam(req, "token")));
  });

  return router;
}
