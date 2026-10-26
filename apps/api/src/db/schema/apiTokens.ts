import { apiScopes } from "@trail/contracts/apiScope";
import { sql } from "drizzle-orm";
import { check, cidr, index, inet, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/**
 * Credentials of the public API (docs/architecture.md §8.4). Only the SHA-256
 * of the secret is stored. A row is kept 30 days after it was revoked or
 * expired, for the audit trail, then pruned.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 hex of the secret. */
    tokenHash: text("token_hash").notNull().unique("api_tokens_token_hash_key"),
    /** Last four characters of the secret. */
    tokenHint: text("token_hint").notNull(),
    /** From the contracts' vocabulary, which the check below repeats: a new scope needs a migration. */
    scopes: text("scopes", { enum: apiScopes }).array().notNull(),
    /** Null = every device of the user; deleting a device removes its id (an empty list = none). */
    deviceIds: uuid("device_ids").array(),
    /** Null = any client address. */
    allowedIps: cidr("allowed_ips").array(),
    /** Null = never. */
    expiresAt: timestamptz("expires_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** Written at most once a minute per token. */
    lastUsedAt: timestamptz("last_used_at"),
    lastUsedIp: inet("last_used_ip"),
    revokedAt: timestamptz("revoked_at"),
  },
  (table) => [
    index("api_tokens_user_id_idx").on(table.userId),
    check("api_tokens_name_check", sql`char_length(${table.name}) BETWEEN 1 AND 60`),
    check(
      "api_tokens_scopes_check",
      sql`cardinality(${table.scopes}) > 0 AND ${table.scopes} <@ ARRAY[${sql.raw(apiScopes.map((scope) => `'${scope}'`).join(", "))}]::text[]`,
    ),
  ],
);
