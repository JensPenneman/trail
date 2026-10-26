import type { IncomingShare } from "@trail/contracts/share";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { shares } from "../db/schema/shares";
import { users } from "../db/schema/users";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { currentShare } from "./currentShare";
import type { ShareRow } from "./outgoingShares";

/** A share as its recipient sees it. */
export function toIncomingShare(
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
  db: Executor,
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
 * Hides or shows a person who shares with the viewer. Hiding keeps its first
 * time stamp; `changed` says whether the state actually moved (only then is
 * the owner told).
 */
export async function setShareHidden(
  db: Executor,
  viewerId: string,
  shareId: string,
  hidden: boolean,
  now = new Date(),
): Promise<{ share: IncomingShare; changed: boolean }> {
  if (!isUuid(shareId)) throw notFound("No such share.");
  const mine = and(eq(shares.id, shareId), eq(shares.recipientUserId, viewerId), currentShare(now));
  const [before] = await db.select({ hiddenAt: shares.hiddenAt }).from(shares).where(mine).limit(1);
  if (before === undefined) throw notFound("No such share.");
  const [row] = await db
    .update(shares)
    .set({
      hiddenAt: hidden
        ? sql`coalesce(${shares.hiddenAt}, ${now.toISOString()}::timestamptz)`
        : null,
    })
    .where(mine)
    .returning();
  if (row === undefined) throw notFound("No such share.");
  const [owner] = await db
    .select(ownerColumns)
    .from(users)
    .where(eq(users.id, row.ownerUserId))
    .limit(1);
  if (owner === undefined) throw notFound("No such share.");
  return { share: toIncomingShare(row, owner), changed: (before.hiddenAt !== null) !== hidden };
}
