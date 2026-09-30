import { and, eq, gt } from "drizzle-orm";
import type { RequestHandler } from "express";
import type { Database } from "../db/database";
import { sessions } from "../db/schema/sessions";
import { users } from "../db/schema/users";
import { hashToken } from "../lib/hashToken";
import { setRequestAuth } from "./requestAuth";
import { clearedSessionCookie, readSessionToken, sessionCookie } from "./sessionCookie";

/** Sliding expiry is refreshed at most this often, so reads do not turn into writes. */
const refreshAfterMs = 5 * 60_000;

/**
 * Resolves the session cookie to a user for the rest of the request. A stale
 * or unknown cookie is cleared; an active session slides its expiry forward.
 */
export function loadSession(db: Database, sessionTtlDays: number): RequestHandler {
  const ttlMs = sessionTtlDays * 86_400_000;
  return async (req, res, next) => {
    const token = readSessionToken(req);
    if (token === null) {
      next();
      return;
    }
    const id = hashToken(token);
    const now = new Date();
    const [row] = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
      .limit(1);
    if (row === undefined) {
      res.append("Set-Cookie", clearedSessionCookie(req.secure));
      next();
      return;
    }
    if (now.getTime() - row.session.lastSeenAt.getTime() > refreshAfterMs) {
      await db
        .update(sessions)
        .set({
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + ttlMs),
          userAgent: req.get("user-agent") ?? null,
          ip: req.ip ?? null,
        })
        .where(eq(sessions.id, id));
      res.append("Set-Cookie", sessionCookie(token, req.secure, ttlMs / 1000));
    }
    setRequestAuth(req, { user: row.user, sessionId: id });
    next();
  };
}
