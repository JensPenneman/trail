import type { ShareChange } from "@trail/contracts/events";
import type { AppContext } from "../appContext";

/** Changes the owner learns about; every other change is told to the recipient. */
const toldToOwner = new Set<ShareChange>(["hidden", "unhidden", "claimed"]);

/**
 * After a share changed: the owner's cached shares are dropped, so the next
 * upload already follows the change, and the other side gets a `share` event
 * (docs/architecture.md §9), which makes their People page refetch.
 */
export function announceShareChange(
  ctx: AppContext,
  change: { shareId: string; ownerId: string; recipientId: string | null; change: ShareChange },
): void {
  ctx.sharing.forget(change.ownerId);
  const toOwner = toldToOwner.has(change.change);
  const target = toOwner ? change.ownerId : change.recipientId;
  if (target === null) return;
  ctx.bus.publish(target, {
    type: "share",
    shareId: change.shareId,
    userId: toOwner ? change.recipientId : change.ownerId,
    change: change.change,
  });
}
