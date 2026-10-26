import { and, gt, isNull, or, sql } from "drizzle-orm";
import { apiTokens } from "../db/schema/apiTokens";

/** SQL for "neither revoked nor expired", by the database's clock. */
export const activeToken = () =>
  and(
    isNull(apiTokens.revokedAt),
    or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, sql`now()`)),
  );
