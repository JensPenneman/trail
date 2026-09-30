import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import type { AppContext } from "../appContext";
import { sessions } from "../db/schema/sessions";
import { getRequestAuth } from "./requestAuth";
import { clearedSessionCookie } from "./sessionCookie";

/** Ends the current session (if any): row deleted, cookie cleared, live streams closed. */
export async function logout(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const auth = getRequestAuth(req);
  if (auth !== undefined) {
    await ctx.db.delete(sessions).where(eq(sessions.id, auth.sessionId));
    ctx.bus.disconnectSession(auth.sessionId);
  }
  res.append("Set-Cookie", clearedSessionCookie(req.secure));
}
