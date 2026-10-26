import { desc, eq } from "drizzle-orm";
import type { Executor } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";
import type { ApiTokenRow } from "./toApiToken";

/** The user's tokens, newest first; revoked and expired ones too until they are pruned. */
export function listApiTokens(db: Executor, userId: string): Promise<ApiTokenRow[]> {
  return db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
}
