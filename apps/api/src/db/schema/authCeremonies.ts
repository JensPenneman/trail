import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea } from "../columns/bytea";
import { timestamptz } from "../columns/timestamptz";
import { invites } from "./invites";
import { passkeyLinks } from "./passkeyLinks";
import { users } from "./users";

export const ceremonyKinds = ["register", "authenticate", "add_passkey", "link"] as const;
export type CeremonyKind = (typeof ceremonyKinds)[number];

/** Pending WebAuthn challenges: single use, bound to an origin + RP ID, valid for 5 minutes. */
export const authCeremonies = pgTable(
  "auth_ceremonies",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    kind: text("kind", { enum: ceremonyKinds }).notNull(),
    challenge: text("challenge").notNull(),
    rpId: text("rp_id").notNull(),
    origin: text("origin").notNull(),
    /** Registration of a new account: the address being signed up. */
    email: text("email"),
    /** Registration of a new account: the user handle given to the authenticator. */
    webauthnUserId: bytea("webauthn_user_id"),
    /** add_passkey / link / targeted authenticate. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    inviteId: uuid("invite_id").references(() => invites.id, { onDelete: "cascade" }),
    linkId: uuid("link_id").references(() => passkeyLinks.id, { onDelete: "cascade" }),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("auth_ceremonies_expires_at_idx").on(table.expiresAt),
    check(
      "auth_ceremonies_kind_check",
      sql`${table.kind} IN ('register', 'authenticate', 'add_passkey', 'link')`,
    ),
  ],
);
