import type { ApiScope } from "@trail/contracts/apiScope";
import { maxActiveApiTokens, maxStoredApiTokens } from "@trail/contracts/apiToken";
import { count, eq, sql } from "drizzle-orm";
import type { Database } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";
import { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";
import { activeToken } from "./activeToken";
import { futureExpiry } from "./futureExpiry";
import { generateApiTokenSecret } from "./generateApiTokenSecret";
import { lockTokenDevices } from "./lockTokenDevices";
import type { ApiTokenRow } from "./toApiToken";

export interface NewApiToken {
  name: string;
  scopes: ApiScope[];
  deviceIds: string[] | null;
  allowedIps: string[] | null;
  expiresAt: string | null;
}

/**
 * A new token for the user, with its one-time secret. At most
 * `maxActiveApiTokens` may be active at once and `maxStoredApiTokens` be kept
 * in all, revoked and expired ones included (409 beyond either).
 */
export async function createApiToken(
  db: Database,
  userId: string,
  input: NewApiToken,
): Promise<{ row: ApiTokenRow; secret: string }> {
  const expiresAt = futureExpiry(input.expiresAt);
  const generated = generateApiTokenSecret();
  const row = await db.transaction(async (tx) => {
    // One creation at a time per account: two parallel requests cannot both take the last place.
    await tx.execute(sql`SELECT 1 FROM ${users} WHERE ${users.id} = ${userId} FOR NO KEY UPDATE`);
    await lockTokenDevices(tx, userId, input.deviceIds);
    const [counted] = await tx
      .select({
        stored: count(),
        active: sql<number>`count(*) FILTER (WHERE ${activeToken()})`.mapWith(Number),
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId));
    if ((counted?.active ?? 0) >= maxActiveApiTokens) {
      throw new HttpError(
        409,
        "conflict",
        `You have ${maxActiveApiTokens} active API tokens, the most an account can have. Revoke one you no longer use first.`,
      );
    }
    if ((counted?.stored ?? 0) >= maxStoredApiTokens) {
      throw new HttpError(
        409,
        "conflict",
        `This account keeps ${maxStoredApiTokens} API tokens, active, expired and revoked ones together. Expired and revoked tokens are removed 30 days after they stop working; try again then.`,
      );
    }
    const [created] = await tx
      .insert(apiTokens)
      .values({
        userId,
        name: input.name,
        tokenHash: generated.hash,
        tokenHint: generated.hint,
        scopes: input.scopes,
        deviceIds: input.deviceIds,
        allowedIps: input.allowedIps,
        expiresAt,
      })
      .returning();
    if (created === undefined) throw new Error("The new API token was not stored");
    return created;
  });
  return { row, secret: generated.secret };
}
