import type { OutgoingShare } from "@trail/contracts/share";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../appContext";
import type { RequestAuth } from "../auth/requestAuth";
import { shares } from "../db/schema/shares";
import { users } from "../db/schema/users";
import { HttpError, notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { announceShareChange } from "./announceShareChange";
import { currentShare } from "./currentShare";
import { hiddenSince } from "./hiddenSince";
import { toOutgoingShare } from "./outgoingShares";
import { assertWithinTokenDevices } from "./shareableDevices";

/**
 * The owner confirms that the account which signed up with a waiting share's
 * address is the person they meant (docs/architecture.md §8.5): only now does
 * that account see them. Nothing to confirm yet, or any more, is 409.
 */
export async function confirmShare(
  ctx: AppContext,
  auth: RequestAuth,
  shareId: string,
): Promise<OutgoingShare> {
  if (!isUuid(shareId)) throw notFound("No such share.");
  const now = new Date();
  const confirmed = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(shares)
      .where(and(eq(shares.id, shareId), eq(shares.ownerUserId, auth.user.id), currentShare(now)))
      .for("update")
      .limit(1);
    if (row === undefined) throw notFound("No such share.");
    // It starts showing positions: like any change, only within a limited token's devices.
    assertWithinTokenDevices(auth, row.deviceIds);
    if (row.recipientUserId !== null) {
      throw new HttpError(409, "conflict", "This share already reaches its person.");
    }
    const [account] = await tx
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.email, row.recipientEmail))
      .limit(1);
    if (account === undefined) {
      throw new HttpError(409, "conflict", "Nobody has signed up with this address yet.");
    }
    const [bound] = await tx
      .update(shares)
      .set({
        recipientUserId: account.id,
        hiddenAt: await hiddenSince(tx, account.id, auth.user.id),
      })
      .where(eq(shares.id, row.id))
      .returning();
    if (bound === undefined) throw notFound("No such share.");
    return { bound, name: account.displayName };
  });
  ctx.logger.info({ shareId: confirmed.bound.id, ownerId: auth.user.id }, "share confirmed");
  if (confirmed.bound.hiddenAt === null) {
    announceShareChange(ctx, {
      shareId: confirmed.bound.id,
      ownerId: auth.user.id,
      recipientId: confirmed.bound.recipientUserId,
      change: "created",
    });
  } else {
    ctx.sharing.forget(auth.user.id);
  }
  return toOutgoingShare(confirmed.bound, confirmed.name);
}
