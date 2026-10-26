import { and, eq } from "drizzle-orm";
import type { Transaction } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";
import { HttpError, notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { apiTokenStatus } from "./apiTokenStatus";
import type { ApiTokenRow } from "./toApiToken";

/**
 * One of the user's tokens, locked for a change. Unknown, malformed and
 * foreign ids are 404; a revoked or expired token can no longer be changed or
 * rolled (409): it is kept for the record only.
 */
export async function lockActiveToken(
  tx: Transaction,
  userId: string,
  tokenId: string,
): Promise<ApiTokenRow> {
  if (!isUuid(tokenId)) throw notFound("No such token.");
  const [token] = await tx
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .for("update");
  if (token === undefined) throw notFound("No such token.");
  const status = apiTokenStatus(token);
  if (status === "revoked") throw new HttpError(409, "conflict", "This token has been revoked.");
  if (status === "expired") {
    throw new HttpError(409, "conflict", "This token has expired. Create a new one.");
  }
  return token;
}
