import { type FinishAuthResponse, finishAuthRequestSchema } from "@trail/contracts/auth";
import type { Request, Response } from "express";
import type { AppContext } from "../appContext";
import { HttpError } from "../http/httpError";
import { parseBody } from "../http/parseInput";
import { consumeCeremony } from "./ceremonies";
import { finishAddPasskey } from "./finishAddPasskey";
import { finishLink } from "./finishLink";
import { finishSignIn } from "./finishSignIn";
import { finishSignUp } from "./finishSignUp";
import { requireAuth } from "./requestAuth";
import { requireCeremonyOrigin } from "./requireCeremonyOrigin";
import { startSession } from "./startSession";
import { toSessionUser } from "./toSessionUser";

/**
 * `POST /api/auth/finish` — completes any ceremony. The stored ceremony says
 * what the response must be; sign-up, sign-in and passkey links end with a new
 * session cookie, adding a passkey keeps the current session.
 */
export async function finishCeremony(
  ctx: AppContext,
  req: Request,
  res: Response,
): Promise<FinishAuthResponse> {
  const { origin } = requireCeremonyOrigin(req, ctx.config.allowedOrigins);
  const body = parseBody(finishAuthRequestSchema, req);
  const ceremony = await consumeCeremony(ctx.db, body.ceremonyId);
  if (ceremony.origin !== origin) {
    throw new HttpError(403, "origin_not_allowed", "Finish on the page where you started.");
  }

  const sessionFor = async (userId: string) =>
    startSession(ctx.db, req, res, { userId, ttlDays: ctx.config.sessionTtlDays });

  switch (ceremony.kind) {
    case "register": {
      const user = await finishSignUp(ctx, ceremony, body.response);
      await sessionFor(user.id);
      ctx.logger.info({ userId: user.id, admin: user.isAdmin }, "account created");
      return { user: toSessionUser(user), created: true };
    }
    case "authenticate": {
      const user = await finishSignIn(ctx, ceremony, body.response);
      await sessionFor(user.id);
      return { user: toSessionUser(user), created: false };
    }
    case "link": {
      const user = await finishLink(ctx, ceremony, body.response);
      await sessionFor(user.id);
      ctx.logger.info({ userId: user.id, rpId: ceremony.rpId }, "passkey added through a link");
      return { user: toSessionUser(user), created: false };
    }
    case "add_passkey": {
      const { user } = requireAuth(req);
      await finishAddPasskey(ctx, ceremony, { userId: user.id, response: body.response });
      return { user: toSessionUser(user), created: false };
    }
  }
}
