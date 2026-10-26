import { and, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";

/**
 * Revokes one of the user's tokens at once. The row stays for the record (30
 * days, then pruning removes it). Revoking a revoked token changes nothing;
 * the answer says whether this call revoked it.
 */
export async function revokeApiToken(
  db: Executor,
  userId: string,
  tokenId: string,
): Promise<boolean> {
  if (!isUuid(tokenId)) throw notFound("No such token.");
  const owned = and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId));
  const [revoked] = await db
    .update(apiTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(owned, isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (revoked !== undefined) return true;
  const [existing] = await db.select({ id: apiTokens.id }).from(apiTokens).where(owned).limit(1);
  if (existing === undefined) throw notFound("No such token.");
  return false;
}
