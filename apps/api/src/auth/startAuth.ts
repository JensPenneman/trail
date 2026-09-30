import { randomBytes } from "node:crypto";
import { type StartAuthResponse, startAuthRequestSchema } from "@trail/contracts/auth";
import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import type { AppContext } from "../appContext";
import { passkeys } from "../db/schema/passkeys";
import { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";
import { parseBody } from "../http/parseInput";
import { authenticationOptions } from "./authenticationOptions";
import { createCeremony } from "./ceremonies";
import { findValidInvite } from "./findValidInvite";
import { isSignupAllowlisted } from "./isSignupAllowlisted";
import { registrationOptions } from "./registrationOptions";
import { requireCeremonyOrigin } from "./requireCeremonyOrigin";

const localPart = (email: string): string => email.slice(0, email.lastIndexOf("@"));

/**
 * `POST /api/auth/start` — the single "Continue with email" step: sign in when
 * the account exists (with the passkeys of this origin's RP ID), sign up when
 * the address may create one (allow-list or a matching invite), else 403.
 */
export async function startAuth(ctx: AppContext, req: Request): Promise<StartAuthResponse> {
  const { origin, rpId } = requireCeremonyOrigin(req, ctx.config.allowedOrigins);
  const body = parseBody(startAuthRequestSchema, req);
  const { db } = ctx;

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (user !== undefined) {
    const usable = await db
      .select({ id: passkeys.id, transports: passkeys.transports })
      .from(passkeys)
      .where(and(eq(passkeys.userId, user.id), eq(passkeys.rpId, rpId)));
    if (usable.length === 0) {
      throw new HttpError(
        409,
        "no_passkey_for_origin",
        "This account has no passkey for this address yet. Use a sign-in link: open Settings → “Add a passkey on another device or address” where you are signed in.",
      );
    }
    const options = await authenticationOptions({ rpId, allowCredentials: usable });
    const ceremonyId = await createCeremony(db, {
      kind: "authenticate",
      challenge: options.challenge,
      rpId,
      origin,
      userId: user.id,
    });
    return { flow: "authenticate", ceremonyId, options };
  }

  const invite =
    body.inviteToken === undefined ? null : await findValidInvite(db, body.inviteToken);
  const inviteMatches = invite !== null && (invite.email === null || invite.email === body.email);
  if (!inviteMatches && !isSignupAllowlisted(body.email, ctx.config.signupAllowlist)) {
    throw new HttpError(
      403,
      "signup_not_allowed",
      body.inviteToken === undefined
        ? "This address has no account and is not invited. Ask an administrator for an invite."
        : "This invite is not valid for this address, has expired or was already used.",
    );
  }

  const webauthnUserId = randomBytes(32);
  const options = await registrationOptions({
    rpId,
    email: body.email,
    displayName: localPart(body.email),
    webauthnUserId,
    existing: [],
  });
  const ceremonyId = await createCeremony(db, {
    kind: "register",
    challenge: options.challenge,
    rpId,
    origin,
    email: body.email,
    webauthnUserId,
    ...(inviteMatches ? { inviteId: invite.id } : {}),
  });
  return { flow: "register", ceremonyId, options };
}
