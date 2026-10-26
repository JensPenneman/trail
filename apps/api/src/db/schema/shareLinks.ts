import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/**
 * Public links to a location (docs/architecture.md §5). Only the SHA-256 of
 * the secret is stored. Revoked and expired links are pruned 30 days later.
 */
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique("share_links_token_hash_key"),
    /** Shown to visitors. */
    label: text("label").notNull(),
    /** Null = every device of the owner, also later ones. */
    deviceIds: uuid("device_ids").array(),
    precision: text("precision", { enum: ["precise", "approximate", "area"] }).notNull(),
    /** Null = the newest position only. */
    historyDays: integer("history_days"),
    includeDetails: boolean("include_details").notNull().default(false),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
    /** Page views, counted at most once a minute. */
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamptz("last_viewed_at"),
  },
  (table) => [
    index("share_links_owner_user_id_idx").on(table.ownerUserId),
    check(
      "share_links_precision_check",
      sql`${table.precision} IN ('precise', 'approximate', 'area')`,
    ),
    check(
      "share_links_history_days_check",
      sql`${table.historyDays} IS NULL OR (${table.historyDays} BETWEEN 1 AND 7 AND ${table.precision} = 'precise')`,
    ),
  ],
);
