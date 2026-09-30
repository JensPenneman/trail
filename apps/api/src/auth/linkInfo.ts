import type { LinkInfoResponse } from "@trail/contracts/auth";
import type { Database } from "../db/database";
import { findValidInvite } from "./findValidInvite";
import { findValidPasskeyLink } from "./findValidPasskeyLink";
import { linkInvalid, requireLinkToken } from "./linkToken";

/**
 * `GET /api/auth/link/:token` — what a one-time link is for: an invite (with
 * its bound address, if any) or a passkey link (with the account's address).
 */
export async function linkInfo(db: Database, rawToken: string): Promise<LinkInfoResponse> {
  const token = requireLinkToken(rawToken);
  const passkeyLink = await findValidPasskeyLink(db, token);
  if (passkeyLink !== null) {
    return {
      kind: "passkey",
      email: passkeyLink.user.email,
      expiresAt: passkeyLink.link.expiresAt.toISOString(),
    };
  }
  const invite = await findValidInvite(db, token);
  if (invite !== null) {
    return { kind: "invite", email: invite.email, expiresAt: invite.expiresAt.toISOString() };
  }
  throw linkInvalid();
}
