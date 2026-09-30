import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import type { Database } from "../db/database";
import { sessions } from "../db/schema/sessions";
import { hashToken } from "../lib/hashToken";
import { randomToken } from "../lib/randomToken";
import { getRequestAuth } from "./requestAuth";
import { sessionCookie } from "./sessionCookie";

/**
 * Creates a session for a user who just proved a passkey and sets its cookie.
 * A session the browser already had is replaced (the cookie name is the same),
 * so its row is removed instead of lingering until it expires.
 */
export async function startSession(
  db: Database,
  req: Request,
  res: Response,
  input: { userId: string; ttlDays: number },
): Promise<string> {
  const previous = getRequestAuth(req);
  if (previous !== undefined) await db.delete(sessions).where(eq(sessions.id, previous.sessionId));

  const token = randomToken();
  const id = hashToken(token);
  const ttlMs = input.ttlDays * 86_400_000;
  await db.insert(sessions).values({
    id,
    userId: input.userId,
    expiresAt: new Date(Date.now() + ttlMs),
    userAgent: req.get("user-agent") ?? null,
    ip: req.ip ?? null,
  });
  res.append("Set-Cookie", sessionCookie(token, req.secure, ttlMs / 1000));
  return id;
}
