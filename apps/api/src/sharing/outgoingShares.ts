import type { OutgoingShare } from "@trail/contracts/share";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../db/database";
import { shares } from "../db/schema/shares";
import { users } from "../db/schema/users";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { currentShare } from "./currentShare";

export type ShareRow = typeof shares.$inferSelect;

const recipients = alias(users, "recipient");
/** The account that signed up with a waiting share's address since: the owner confirms it. */
const joiners = alias(users, "joined");

/**
 * A share as its owner sees it, with the recipient's name once bound — or,
 * while it waits for the owner's confirmation, the name of whoever signed up
 * with the address (`joined`).
 */
export function toOutgoingShare(
  row: ShareRow,
  recipientName: string | null,
  joinedName: string | null = null,
): OutgoingShare {
  const bound = row.recipientUserId !== null;
  return {
    id: row.id,
    recipient: {
      email: row.recipientEmail,
      userId: row.recipientUserId,
      displayName: bound ? recipientName : joinedName,
    },
    status: !bound
      ? joinedName === null
        ? "pending"
        : "joined"
      : row.hiddenAt === null
        ? "active"
        : "hidden",
    deviceIds: row.deviceIds,
    precision: row.precision,
    historyDays: row.historyDays,
    includeDetails: row.includeDetails,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
  };
}

/** The owner's current shares, newest first. */
export async function loadOutgoingShares(
  db: Executor,
  ownerId: string,
  now = new Date(),
): Promise<OutgoingShare[]> {
  const rows = await db
    .select({
      share: shares,
      recipientName: recipients.displayName,
      joinedName: joiners.displayName,
    })
    .from(shares)
    .leftJoin(recipients, eq(recipients.id, shares.recipientUserId))
    .leftJoin(
      joiners,
      and(isNull(shares.recipientUserId), eq(joiners.email, shares.recipientEmail)),
    )
    .where(and(eq(shares.ownerUserId, ownerId), currentShare(now)))
    .orderBy(desc(shares.createdAt), desc(shares.id));
  return rows.map((row) => toOutgoingShare(row.share, row.recipientName, row.joinedName));
}

/** One current share of the owner; anything else — someone else's, stopped, ended, unknown — is 404. */
export async function findOutgoingShare(
  db: Executor,
  ownerId: string,
  shareId: string,
  now = new Date(),
): Promise<{ share: ShareRow; recipientName: string | null; joinedName: string | null }> {
  if (!isUuid(shareId)) throw notFound("No such share.");
  const [row] = await db
    .select({
      share: shares,
      recipientName: recipients.displayName,
      joinedName: joiners.displayName,
    })
    .from(shares)
    .leftJoin(recipients, eq(recipients.id, shares.recipientUserId))
    .leftJoin(
      joiners,
      and(isNull(shares.recipientUserId), eq(joiners.email, shares.recipientEmail)),
    )
    .where(and(eq(shares.id, shareId), eq(shares.ownerUserId, ownerId), currentShare(now)))
    .limit(1);
  if (row === undefined) throw notFound("No such share.");
  return row;
}
