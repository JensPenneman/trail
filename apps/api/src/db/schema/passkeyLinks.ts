import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/** One-time links that add a passkey to an existing account (recovery, another device or origin). */
export const passkeyLinks = pgTable(
  "passkey_links",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tokenHash: text("token_hash").notNull().unique("passkey_links_token_hash_key"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The allowed origin the link opens on; its hostname becomes the new passkey's RP ID. */
    origin: text("origin").notNull(),
    createdBy: text("created_by", { enum: ["cli", "user"] }).notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
  },
  (table) => [
    index("passkey_links_user_id_idx").on(table.userId),
    check("passkey_links_created_by_check", sql`${table.createdBy} IN ('cli', 'user')`),
  ],
);
