import type { IncomingShare } from "@trail/contracts/share";
import type { AppContext } from "../appContext";
import type { RequestAuth } from "../auth/requestAuth";
import { announceShareChange } from "./announceShareChange";
import { setShareHidden } from "./incomingShares";

/**
 * Hides a person who shares with the principal, or shows them again. A hidden
 * person is left out of every read and receives no live events for the
 * principal; the share itself stays the owner's, who is told about it.
 */
export async function setPersonHidden(
  ctx: AppContext,
  auth: RequestAuth,
  shareId: string,
  hidden: boolean,
): Promise<IncomingShare> {
  const { share, changed } = await setShareHidden(ctx.db, auth.user.id, shareId, hidden);
  if (changed) {
    announceShareChange(ctx, {
      shareId: share.id,
      ownerId: share.owner.userId,
      recipientId: auth.user.id,
      change: hidden ? "hidden" : "unhidden",
    });
  }
  return share;
}
