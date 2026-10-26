import type { TokenVerification } from "@trail/contracts/apiToken";
import { and, eq } from "drizzle-orm";
import type { TokenPrincipal } from "../auth/requestAuth";
import type { Executor } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";
import { apiTokenStatus } from "./apiTokenStatus";

/** The calling token as `tokens/verify` describes it; null if it vanished since it was verified. */
export async function describeToken(
  db: Executor,
  principal: TokenPrincipal,
): Promise<TokenVerification | null> {
  const [token] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, principal.tokenId), eq(apiTokens.userId, principal.user.id)))
    .limit(1);
  if (token === undefined) return null;
  return {
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    deviceIds: token.deviceIds,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    status: apiTokenStatus(token),
  };
}
