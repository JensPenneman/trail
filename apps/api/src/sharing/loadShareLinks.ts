import type { ShareLink } from "@trail/contracts/shareLink";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { shareLinks } from "../db/schema/shareLinks";
import { toShareLink } from "./toShareLink";

/** The list is bounded: every working link (at most 20) and the newest expired ones. */
const listedShareLinks = 50;

/**
 * The owner's links that were not turned off: the working ones, then expired
 * ones (kept 30 days), each newest first, at most `listedShareLinks` in all.
 */
export async function loadShareLinks(db: Executor, ownerId: string): Promise<ShareLink[]> {
  const rows = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.ownerUserId, ownerId), isNull(shareLinks.revokedAt)))
    .orderBy(
      desc(sql`${shareLinks.expiresAt} > now()`),
      desc(shareLinks.createdAt),
      desc(shareLinks.id),
    )
    .limit(listedShareLinks);
  const now = new Date();
  return rows.map((row) => toShareLink(row, now));
}
