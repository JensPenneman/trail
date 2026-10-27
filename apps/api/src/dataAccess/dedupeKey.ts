import { createHash } from "node:crypto";
import type { DataAccessResource } from "@trail/contracts/dataAccess";
import type { AccessActor } from "./accessRecord";

/** What makes two accesses the same actor's: never a label, which may change. */
export function actorIdentity(actor: AccessActor): readonly (string | null)[] {
  switch (actor.kind) {
    case "owner":
      return ["owner", actor.sessionId];
    case "token":
      return ["token", actor.tokenId];
    case "person":
      return ["person", actor.userId, actor.shareId];
    case "link":
      return [
        "link",
        actor.linkId,
        actor.visitor?.ipCoarse ?? null,
        actor.visitor?.uaFamily ?? null,
      ];
  }
}

/**
 * The key that folds repeated accesses into one row of an hour: SHA-256
 * (base64url) of the actor, channel, action, kind and the canonical resource.
 */
export function dedupeKey(input: {
  actor: AccessActor;
  channel: string;
  action: string;
  access: string;
  resource: DataAccessResource;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        actorIdentity(input.actor),
        input.channel,
        input.action,
        input.access,
        input.resource,
      ]),
    )
    .digest("base64url");
}
