import { and, eq, gt, isNull } from "drizzle-orm";
import type { Executor } from "../db/database";
import { passkeyLinks } from "../db/schema/passkeyLinks";
import { users } from "../db/schema/users";
import { hashToken } from "../lib/hashToken";
import type { UserRow } from "./requestAuth";

export type PasskeyLinkRow = typeof passkeyLinks.$inferSelect;

/** A passkey link that is neither used nor expired, with the account it adds a passkey to. */
export async function findValidPasskeyLink(
  db: Executor,
  token: string,
): Promise<{ link: PasskeyLinkRow; user: UserRow } | null> {
  const [row] = await db
    .select({ link: passkeyLinks, user: users })
    .from(passkeyLinks)
    .innerJoin(users, eq(users.id, passkeyLinks.userId))
    .where(
      and(
        eq(passkeyLinks.tokenHash, hashToken(token)),
        isNull(passkeyLinks.usedAt),
        gt(passkeyLinks.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}
