import { apiPaths } from "@trail/contracts/apiPaths";
import type { SessionListResponse } from "@trail/contracts/session";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { clearedSessionCookie } from "../auth/sessionCookie";
import { sessions } from "../db/schema/sessions";
import { notFound } from "../http/httpError";
import { toSessionInfo } from "./toSessionInfo";

/** `/api/me/sessions*` — signed-in browsers of the user; revoking one also closes its live stream. */
export function sessionsRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db } = ctx;

  const listSessions = async (userId: string, currentSessionId: string) => {
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    const body: SessionListResponse = {
      sessions: rows.map((row) => toSessionInfo(row, currentSessionId)),
    };
    return body;
  };

  router.get(apiPaths.me.sessions, async (req, res) => {
    const { user, sessionId } = requireAuth(req);
    res.json(await listSessions(user.id, sessionId));
  });

  router.post(apiPaths.me.revokeOtherSessions, async (req, res) => {
    const { user, sessionId } = requireAuth(req);
    const revoked = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, user.id), ne(sessions.id, sessionId)))
      .returning({ id: sessions.id });
    for (const { id } of revoked) ctx.bus.disconnectSession(id);
    res.json(await listSessions(user.id, sessionId));
  });

  router.delete("/api/me/sessions/:id", async (req, res) => {
    const { user, sessionId } = requireAuth(req);
    const [revoked] = await db
      .delete(sessions)
      .where(and(eq(sessions.id, req.params.id), eq(sessions.userId, user.id)))
      .returning({ id: sessions.id });
    if (revoked === undefined) throw notFound("No such session.");
    ctx.bus.disconnectSession(revoked.id);
    if (revoked.id === sessionId) res.append("Set-Cookie", clearedSessionCookie(req.secure));
    res.status(204).end();
  });

  return router;
}
