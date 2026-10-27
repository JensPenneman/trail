import type { DataAccessActorRef } from "@trail/contracts/dataAccessActorId";
import { type SQL, sql } from "drizzle-orm";

/**
 * Only the rows of one actor (the `actorId` filter of the list and the
 * summary), as a condition on `data_access_events e`: a person by their
 * account, whichever share they looked through, a token or a link by its id,
 * and the owner's own browser by the name the row keeps — what the summary
 * lists its sessions by, as the log keeps no session ids to show.
 */
export function actorCondition(ref: DataAccessActorRef | undefined): SQL {
  if (ref === undefined) return sql``;
  switch (ref.kind) {
    case "person":
      return sql`AND e.actor_kind = 'person' AND e.actor_user_id = ${ref.userId}::uuid`;
    case "token":
      return sql`AND e.actor_kind = 'token' AND e.actor_token_id = ${ref.tokenId}::uuid`;
    case "link":
      return sql`AND e.actor_kind = 'link' AND e.actor_link_id = ${ref.linkId}::uuid`;
    case "session":
      return sql`AND e.actor_kind = 'owner' AND e.actor_label = ${ref.label}`;
  }
}
