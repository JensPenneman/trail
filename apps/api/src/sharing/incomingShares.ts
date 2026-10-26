import type { IncomingShare } from "@trail/contracts/share";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/database";
import { hiddenPeople } from "../db/schema/hiddenPeople";
import { shares } from "../db/schema/shares";
import { users } from "../db/schema/users";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { currentShare } from "./currentShare";
import type { ShareRow } from "./outgoingShares";

/** A share as its recipient sees it. */
function toIncomingShare(
  row: ShareRow,
  owner: { displayName: string; email: string },
): IncomingShare {
  return {
    id: row.id,
    owner: { userId: row.ownerUserId, displayName: owner.displayName, email: owner.email },
    precision: row.precision,
    historyDays: row.historyDays,
    includeDetails: row.includeDetails,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    hiddenAt: row.hiddenAt?.toISOString() ?? null,
  };
}

const ownerColumns = { displayName: users.displayName, email: users.email };

/** The current shares with the viewer, hidden ones included, newest first. */
export async function loadIncomingShares(
  db: Database,
  viewerId: string,
  now = new Date(),
): Promise<IncomingShare[]> {
  const rows = await db
    .select({ share: shares, owner: ownerColumns })
    .from(shares)
    .innerJoin(users, eq(users.id, shares.ownerUserId))
    .where(and(eq(shares.recipientUserId, viewerId), currentShare(now)))
    .orderBy(desc(shares.createdAt), desc(shares.id));
  return rows.map((row) => toIncomingShare(row.share, row.owner));
}

/**
 * Hides or shows a person who shares with the viewer — the person, not just
 * this share: the choice is kept in `hidden_people`, so a later share from
 * them arrives hidden too. Hiding keeps its first time stamp; `changed` says
 * whether the state actually moved (only then is the owner told).
 */
export async function setShareHidden(
  db: Database,
  viewerId: string,
  shareId: string,
  hidden: boolean,
  now = new Date(),
): Promise<{ share: IncomingShare; changed: boolean }> {
  if (!isUuid(shareId)) throw notFound("No such share.");
  return db.transaction(async (tx) => {
    const mine = and(
      eq(shares.id, shareId),
      eq(shares.recipientUserId, viewerId),
      currentShare(now),
    );
    const [before] = await tx
      .select({ hiddenAt: shares.hiddenAt, ownerUserId: shares.ownerUserId })
      .from(shares)
      .where(mine)
      .limit(1);
    if (before === undefined) throw notFound("No such share.");
    const person = and(
      eq(hiddenPeople.userId, viewerId),
      eq(hiddenPeople.hiddenUserId, before.ownerUserId),
    );
    let hiddenAt: Date | null = null;
    if (hidden) {
      await tx
        .insert(hiddenPeople)
        .values({
          userId: viewerId,
          hiddenUserId: before.ownerUserId,
          hiddenAt: before.hiddenAt ?? now,
        })
        .onConflictDoNothing();
      const [kept] = await tx
        .select({ hiddenAt: hiddenPeople.hiddenAt })
        .from(hiddenPeople)
        .where(person);
      hiddenAt = kept?.hiddenAt ?? now;
    } else {
      await tx.delete(hiddenPeople).where(person);
    }
    const [row] = await tx.update(shares).set({ hiddenAt }).where(mine).returning();
    if (row === undefined) throw notFound("No such share.");
    const [owner] = await tx
      .select(ownerColumns)
      .from(users)
      .where(eq(users.id, row.ownerUserId))
      .limit(1);
    if (owner === undefined) throw notFound("No such share.");
    return { share: toIncomingShare(row, owner), changed: (before.hiddenAt !== null) !== hidden };
  });
}
