import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Executor } from "../db/database";
import { shares } from "../db/schema/shares";

/**
 * Binds the shares that waited for this address to the account just created
 * with it (inside the sign-up transaction). Trail does not verify addresses:
 * whoever may sign up with an address — the allow-list or an invitation
 * decides — receives what was shared with it (SECURITY.md).
 */
export function claimPendingShares(
  tx: Executor,
  user: { id: string; email: string },
  now = new Date(),
): Promise<{ id: string; ownerUserId: string }[]> {
  return tx
    .update(shares)
    .set({ recipientUserId: user.id })
    .where(
      and(
        eq(shares.recipientEmail, user.email),
        isNull(shares.recipientUserId),
        isNull(shares.revokedAt),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, now)),
      ),
    )
    .returning({ id: shares.id, ownerUserId: shares.ownerUserId });
}
