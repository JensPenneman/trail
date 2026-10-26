import { and, eq, isNull, or } from "drizzle-orm";
import type { Executor } from "../db/database";
import { shares } from "../db/schema/shares";

export interface AccountShare {
  id: string;
  ownerUserId: string;
  recipientUserId: string | null;
}

/** The shares an account gives or receives, before the account goes (the cascade removes them). */
export function sharesOfAccount(db: Executor, userId: string): Promise<AccountShare[]> {
  return db
    .select({
      id: shares.id,
      ownerUserId: shares.ownerUserId,
      recipientUserId: shares.recipientUserId,
    })
    .from(shares)
    .where(
      and(
        isNull(shares.revokedAt),
        or(eq(shares.ownerUserId, userId), eq(shares.recipientUserId, userId)),
      ),
    );
}
