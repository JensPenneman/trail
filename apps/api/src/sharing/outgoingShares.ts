import type { OutgoingShare } from "@trail/contracts/share";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../db/database";
import { shares } from "../db/schema/shares";
import { users } from "../db/schema/users";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { currentShare } from "./currentShare";

export type ShareRow = typeof shares.$inferSelect;

const recipients = alias(users, "recipient");

/** A share as its owner sees it; the recipient's name once the address has an account. */
export function toOutgoingShare(row: ShareRow, recipientName: string | null): OutgoingShare {
  return {
    id: row.id,
    recipient: {
      email: row.recipientEmail,
      userId: row.recipientUserId,
      displayName: row.recipientUserId === null ? null : recipientName,
    },
    status: row.recipientUserId === null ? "pending" : row.hiddenAt === null ? "active" : "hidden",
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
    .select({ share: shares, recipientName: recipients.displayName })
    .from(shares)
    .leftJoin(recipients, eq(recipients.id, shares.recipientUserId))
    .where(and(eq(shares.ownerUserId, ownerId), currentShare(now)))
    .orderBy(desc(shares.createdAt), desc(shares.id));
  return rows.map((row) => toOutgoingShare(row.share, row.recipientName));
}

/** One current share of the owner; anything else — someone else's, stopped, ended, unknown — is 404. */
export async function findOutgoingShare(
  db: Executor,
  ownerId: string,
  shareId: string,
  now = new Date(),
): Promise<{ share: ShareRow; recipientName: string | null }> {
  if (!isUuid(shareId)) throw notFound("No such share.");
  const [row] = await db
    .select({ share: shares, recipientName: recipients.displayName })
    .from(shares)
    .leftJoin(recipients, eq(recipients.id, shares.recipientUserId))
    .where(and(eq(shares.id, shareId), eq(shares.ownerUserId, ownerId), currentShare(now)))
    .limit(1);
  if (row === undefined) throw notFound("No such share.");
  return row;
}
