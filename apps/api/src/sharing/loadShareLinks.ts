import type { ShareLink } from "@trail/contracts/shareLink";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Executor } from "../db/database";
import { shareLinks } from "../db/schema/shareLinks";
import { toShareLink } from "./toShareLink";

/** The owner's links that were not turned off, expired ones included, newest first. */
export async function loadShareLinks(db: Executor, ownerId: string): Promise<ShareLink[]> {
  const rows = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.ownerUserId, ownerId), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt), desc(shareLinks.id));
  const now = new Date();
  return rows.map((row) => toShareLink(row, now));
}
