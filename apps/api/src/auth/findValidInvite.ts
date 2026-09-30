import { and, eq, gt, isNull } from "drizzle-orm";
import type { Executor } from "../db/database";
import { invites } from "../db/schema/invites";
import { hashToken } from "../lib/hashToken";

export type InviteRow = typeof invites.$inferSelect;

/** An invite that is neither used nor expired, by its secret token. */
export async function findValidInvite(db: Executor, token: string): Promise<InviteRow | null> {
  const [row] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, hashToken(token)),
        isNull(invites.usedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}
