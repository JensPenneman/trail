import { and, arrayContains, eq, isNull, or, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { shareLinks } from "../db/schema/shareLinks";
import { shares } from "../db/schema/shares";

/**
 * Takes a device that is being deleted out of its owner's shares and links
 * (in the deletion's transaction). A share of only that device then shows no
 * device; it never turns into "every device". Returns the shares that showed
 * it — the ones naming it and the ones of every device — so their recipients
 * can be told.
 */
export async function removeDeviceFromShares(
  tx: Executor,
  ownerId: string,
  deviceId: string,
): Promise<{ id: string; recipientUserId: string | null }[]> {
  const showing = await tx
    .select({ id: shares.id, recipientUserId: shares.recipientUserId })
    .from(shares)
    .where(
      and(
        eq(shares.ownerUserId, ownerId),
        isNull(shares.revokedAt),
        or(isNull(shares.deviceIds), arrayContains(shares.deviceIds, [deviceId])),
      ),
    );
  await tx
    .update(shares)
    .set({ deviceIds: sql`array_remove(${shares.deviceIds}, ${deviceId}::uuid)` })
    .where(and(eq(shares.ownerUserId, ownerId), arrayContains(shares.deviceIds, [deviceId])));
  await tx
    .update(shareLinks)
    .set({ deviceIds: sql`array_remove(${shareLinks.deviceIds}, ${deviceId}::uuid)` })
    .where(
      and(eq(shareLinks.ownerUserId, ownerId), arrayContains(shareLinks.deviceIds, [deviceId])),
    );
  return showing;
}
