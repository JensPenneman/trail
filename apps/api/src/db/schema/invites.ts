import { sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/** Invitations to create an account. Only the SHA-256 of the token is stored. */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tokenHash: text("token_hash").notNull().unique("invites_token_hash_key"),
  /** Null = anyone with the link may sign up. */
  email: text("email"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
  usedAt: timestamptz("used_at"),
  usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
});
