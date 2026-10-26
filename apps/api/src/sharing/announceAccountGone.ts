import type { AppContext } from "../appContext";
import { announceShareChange } from "./announceShareChange";
import type { AccountShare } from "./sharesOfAccount";

/**
 * After an account was deleted: its shares are gone with it, so the people it
 * shared with see it disappear, and the caches of those who shared with it
 * forget it.
 */
export function announceAccountGone(
  ctx: AppContext,
  userId: string,
  gone: readonly AccountShare[],
): void {
  for (const share of gone) {
    if (share.ownerUserId === userId) {
      announceShareChange(ctx, {
        shareId: share.id,
        ownerId: userId,
        recipientId: share.recipientUserId,
        change: "revoked",
      });
    } else {
      ctx.sharing.forget(share.ownerUserId);
    }
  }
}
