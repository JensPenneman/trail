import type { LinkStartResponse } from "@trail/contracts/auth";
import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import type { AppContext } from "../appContext";
import { passkeys } from "../db/schema/passkeys";
import { HttpError } from "../http/httpError";
import { createCeremony } from "./ceremonies";
import { findValidPasskeyLink } from "./findValidPasskeyLink";
import { linkInvalid, requireLinkToken } from "./linkToken";
import { registrationOptions } from "./registrationOptions";
import { requireCeremonyOrigin } from "./requireCeremonyOrigin";

/**
 * `POST /api/auth/link/:token/start` — registration options that add a passkey
 * to the link's account. The link only works on the origin it was made for,
 * because that origin's hostname becomes the passkey's RP ID.
 */
export async function startLinkRegistration(
  ctx: AppContext,
  req: Request,
  rawToken: string,
): Promise<LinkStartResponse> {
  const { origin, rpId } = requireCeremonyOrigin(req, ctx.config.allowedOrigins);
  const token = requireLinkToken(rawToken);
  const found = await findValidPasskeyLink(ctx.db, token);
  if (found === null) throw linkInvalid();
  const { link, user } = found;
  if (link.origin !== origin) {
    throw new HttpError(403, "origin_not_allowed", `Open this link on ${link.origin}.`);
  }

  const existing = await ctx.db
    .select({ id: passkeys.id, transports: passkeys.transports })
    .from(passkeys)
    .where(and(eq(passkeys.userId, user.id), eq(passkeys.rpId, rpId)));
  const options = await registrationOptions({
    rpId,
    email: user.email,
    displayName: user.displayName,
    webauthnUserId: new Uint8Array(user.webauthnUserId),
    existing,
  });
  const ceremonyId = await createCeremony(ctx.db, {
    kind: "link",
    challenge: options.challenge,
    rpId,
    origin,
    userId: user.id,
    linkId: link.id,
  });
  return { ceremonyId, options };
}
