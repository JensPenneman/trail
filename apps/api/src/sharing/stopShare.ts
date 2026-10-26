import { and, eq, isNull } from "drizzle-orm";
import type { AppContext } from "../appContext";
import type { RequestAuth } from "../auth/requestAuth";
import { shares } from "../db/schema/shares";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { announceShareChange } from "./announceShareChange";

/**
 * Stops a share at once: from this moment no read and no live event shows the
 * owner to the recipient. The row stays 30 days (then the hourly prune removes it).
 */
export async function stopShare(
  ctx: AppContext,
  auth: RequestAuth,
  shareId: string,
): Promise<void> {
  if (!isUuid(shareId)) throw notFound("No such share.");
  const [row] = await ctx.db
    .update(shares)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(shares.id, shareId), eq(shares.ownerUserId, auth.user.id), isNull(shares.revokedAt)),
    )
    .returning({ id: shares.id, recipientUserId: shares.recipientUserId });
  if (row === undefined) throw notFound("No such share.");
  ctx.logger.info({ shareId: row.id, ownerId: auth.user.id }, "share stopped");
  announceShareChange(ctx, {
    shareId: row.id,
    ownerId: auth.user.id,
    recipientId: row.recipientUserId,
    change: "revoked",
  });
}
