import { apiPaths } from "@trail/contracts/apiPaths";
import {
  deleteAccountRequestSchema,
  type SessionResponse,
  updateMeRequestSchema,
} from "@trail/contracts/user";
import { eq } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { clearedSessionCookie } from "../auth/sessionCookie";
import { toSessionUser } from "../auth/toSessionUser";
import { allowLongStatements } from "../db/allowLongStatements";
import { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";
import { parseBody } from "../http/parseInput";
import { rebuildUserDailyStats } from "../stats/rebuildUserDailyStats";

/** `GET/PATCH/DELETE /api/me` — profile and account deletion. */
export function meRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.me.root, (req, res) => {
    const body: SessionResponse = { user: toSessionUser(requireAuth(req).user) };
    res.json(body);
  });

  router.patch(apiPaths.me.root, async (req, res) => {
    const auth = requireAuth(req);
    const changes = parseBody(updateMeRequestSchema, req);
    const [user] = await ctx.db
      .update(users)
      .set({
        ...(changes.displayName === undefined ? {} : { displayName: changes.displayName }),
        ...(changes.timezone === undefined ? {} : { timezone: changes.timezone }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, auth.user.id))
      .returning();
    if (user === undefined) throw new HttpError(401, "unauthorized", "Sign in to continue.");
    if (changes.timezone !== undefined && changes.timezone !== auth.user.timezone) {
      // Days are local calendar days: a new time zone moves every day boundary.
      ctx.background.run("rebuild daily stats after a time zone change", () =>
        rebuildUserDailyStats(ctx.db, user.id),
      );
    }
    const body: SessionResponse = { user: toSessionUser(user) };
    res.json(body);
  });

  router.delete(apiPaths.me.root, async (req, res) => {
    const auth = requireAuth(req);
    const { confirmEmail } = parseBody(deleteAccountRequestSchema, req);
    if (confirmEmail !== auth.user.email) {
      throw new HttpError(400, "validation_failed", "Type your email address to confirm.", {
        confirmEmail: ["Does not match the address of this account"],
      });
    }
    // Cascades to every device and point of the account.
    await ctx.db.transaction(async (tx) => {
      await allowLongStatements(tx);
      await tx.delete(users).where(eq(users.id, auth.user.id));
    });
    ctx.bus.disconnectUser(auth.user.id);
    ctx.logger.info({ userId: auth.user.id }, "account deleted");
    res.append("Set-Cookie", clearedSessionCookie(req.secure));
    res.status(204).end();
  });

  return router;
}
