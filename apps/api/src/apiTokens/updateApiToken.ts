import type { ApiScope } from "@trail/contracts/apiScope";
import { eq } from "drizzle-orm";
import type { Database } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";
import { futureExpiry } from "./futureExpiry";
import { lockActiveToken } from "./lockActiveToken";
import { lockTokenDevices } from "./lockTokenDevices";
import type { ApiTokenRow } from "./toApiToken";

export interface ApiTokenChanges {
  name?: string | undefined;
  scopes?: ApiScope[] | undefined;
  deviceIds?: string[] | null | undefined;
  allowedIps?: string[] | null | undefined;
  expiresAt?: string | null | undefined;
}

/** Changes an active token's settings; the secret stays the same and keeps working. */
export async function updateApiToken(
  db: Database,
  userId: string,
  tokenId: string,
  changes: ApiTokenChanges,
): Promise<ApiTokenRow> {
  const expiresAt = changes.expiresAt === undefined ? undefined : futureExpiry(changes.expiresAt);
  return db.transaction(async (tx) => {
    // Devices before the token, in the order a device deletion takes them: no deadlock.
    if (changes.deviceIds !== undefined) await lockTokenDevices(tx, userId, changes.deviceIds);
    const token = await lockActiveToken(tx, userId, tokenId);
    const [updated] = await tx
      .update(apiTokens)
      .set({
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.scopes === undefined ? {} : { scopes: changes.scopes }),
        ...(changes.deviceIds === undefined ? {} : { deviceIds: changes.deviceIds }),
        ...(changes.allowedIps === undefined ? {} : { allowedIps: changes.allowedIps }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      })
      .where(eq(apiTokens.id, token.id))
      .returning();
    return updated ?? token;
  });
}
