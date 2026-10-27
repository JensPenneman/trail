import type { RequestAuth } from "../auth/requestAuth";
import { userAgentLabel } from "../auth/userAgentLabel";
import type { OwnerActor, PersonActor, TokenActor } from "./accessRecord";

/**
 * The caller as the actor of an access to their own data: their browser
 * session (channel `web`, named after the browser) or one of their API tokens
 * (channel `api`, named as they named it).
 */
export function principalActor(
  auth: RequestAuth,
  userAgent: string | null,
): { channel: "web"; actor: OwnerActor } | { channel: "api"; actor: TokenActor } {
  return auth.kind === "session"
    ? {
        channel: "web",
        actor: { kind: "owner", sessionId: auth.sessionId, label: userAgentLabel(userAgent) },
      }
    : { channel: "api", actor: { kind: "token", tokenId: auth.tokenId, label: auth.tokenName } };
}

/**
 * The caller as the actor of an access to someone else's data: the person,
 * through their share — whether they came with a session or a token, and
 * from where, stays out of the other person's log.
 */
export const personActor = (viewer: RequestAuth, shareId: string | null): PersonActor => ({
  kind: "person",
  userId: viewer.user.id,
  shareId,
  label: viewer.user.displayName,
});
