import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Executor } from "../db/database";
import { shares } from "../db/schema/shares";

/** The shares in force that wait for an account with this address. */
export function pendingSharesFor(
  tx: Executor,
  email: string,
  now = new Date(),
): Promise<{ id: string; ownerUserId: string }[]> {
  return tx
    .select({ id: shares.id, ownerUserId: shares.ownerUserId })
    .from(shares)
    .where(
      and(
        eq(shares.recipientEmail, email),
        isNull(shares.recipientUserId),
        isNull(shares.revokedAt),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, now)),
      ),
    );
}

/**
 * Binds waiting shares to the account of their address. Only an invitation
 * to that very address does this at sign-up; otherwise the owner confirms
 * (`confirmShare`), since Trail does not verify addresses.
 */
export async function bindShares(
  tx: Executor,
  shareIds: readonly string[],
  userId: string,
): Promise<void> {
  if (shareIds.length === 0) return;
  await tx
    .update(shares)
    .set({ recipientUserId: userId })
    .where(and(inArray(shares.id, [...shareIds]), isNull(shares.recipientUserId)));
}
