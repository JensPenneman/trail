import { eq } from "drizzle-orm";
import type { Database } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";
import { generateApiToken } from "./generateApiToken";
import { lockActiveToken } from "./lockActiveToken";
import type { ApiTokenRow } from "./toApiToken";

/**
 * A new secret for an active token: same row, name, scopes, devices, addresses
 * and expiry. The old secret's hash is gone with the update, so it stops
 * working with the commit.
 */
export async function rollApiToken(
  db: Database,
  userId: string,
  tokenId: string,
): Promise<{ row: ApiTokenRow; secret: string }> {
  const generated = generateApiToken();
  const row = await db.transaction(async (tx) => {
    const token = await lockActiveToken(tx, userId, tokenId);
    const [rolled] = await tx
      .update(apiTokens)
      .set({ tokenHash: generated.hash, tokenHint: generated.hint })
      .where(eq(apiTokens.id, token.id))
      .returning();
    if (rolled === undefined) throw new Error("The rolled API token was not stored");
    return rolled;
  });
  return { row, secret: generated.token };
}
