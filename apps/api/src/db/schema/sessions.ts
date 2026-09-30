import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/** Signed-in browsers. Only the SHA-256 of the cookie token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 hex of the cookie token. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);
