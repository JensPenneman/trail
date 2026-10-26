import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/**
 * One person's location shared with another (docs/architecture.md §5): by
 * address, bound to the recipient's account at creation, at a sign-up with an
 * invitation to that address, or when the owner confirms who signed up with it.
 * Stopping a share stamps `revoked_at`; revoked and expired rows are pruned 30
 * days later.
 */
export const shares = pgTable(
  "shares",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lower-case; the account it names is the recipient once it exists. */
    recipientEmail: text("recipient_email").notNull(),
    /** Null until bound: pending, or joined and waiting for the owner's confirmation. */
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /** Null = every device of the owner, also later ones. */
    deviceIds: uuid("device_ids").array(),
    precision: text("precision", { enum: ["precise", "approximate", "area"] }).notNull(),
    /** Null = live only. */
    historyDays: integer("history_days"),
    includeDetails: boolean("include_details").notNull().default(true),
    /** Null = until stopped. */
    expiresAt: timestamptz("expires_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
    /** Set by the recipient: hidden people get nothing until shown again. */
    hiddenAt: timestamptz("hidden_at"),
    lastViewedAt: timestamptz("last_viewed_at"),
  },
  (table) => [
    // One current share per owner and address; a stopped one makes room for the next.
    uniqueIndex("shares_owner_user_id_recipient_email_key")
      .on(table.ownerUserId, table.recipientEmail)
      .where(sql`${table.revokedAt} IS NULL`),
    index("shares_recipient_user_id_idx")
      .on(table.recipientUserId)
      .where(sql`${table.revokedAt} IS NULL`),
    // Sign-up looks up the pending shares of the new address.
    index("shares_pending_recipient_email_idx")
      .on(table.recipientEmail)
      .where(sql`${table.recipientUserId} IS NULL AND ${table.revokedAt} IS NULL`),
    check("shares_precision_check", sql`${table.precision} IN ('precise', 'approximate', 'area')`),
    check(
      "shares_history_days_check",
      sql`${table.historyDays} IS NULL OR (${table.historyDays} BETWEEN 1 AND 365 AND ${table.precision} = 'precise')`,
    ),
    check(
      "shares_recipient_email_check",
      sql`${table.recipientEmail} = lower(${table.recipientEmail})`,
    ),
    check("shares_not_self_check", sql`${table.recipientUserId} <> ${table.ownerUserId}`),
  ],
);
