import { sql } from "drizzle-orm";
import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea } from "../columns/bytea";
import { timestamptz } from "../columns/timestamptz";

/** Accounts. The WebAuthn user handle is a separate random value so the uuid never leaves the server. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  email: text("email").notNull().unique("users_email_key"),
  displayName: text("display_name").notNull(),
  webauthnUserId: bytea("webauthn_user_id").notNull().unique("users_webauthn_user_id_key"),
  isAdmin: boolean("is_admin").notNull().default(false),
  timezone: text("timezone").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});
