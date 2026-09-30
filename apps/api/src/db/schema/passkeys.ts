import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea } from "../columns/bytea";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/** WebAuthn credentials. A passkey only works on the RP ID (hostname) it was created for. */
export const passkeys = pgTable(
  "passkeys",
  {
    /** Credential ID, base64url. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rpId: text("rp_id").notNull(),
    publicKey: bytea("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(sql`'{}'::text[]`),
    deviceType: text("device_type", { enum: ["singleDevice", "multiDevice"] }).notNull(),
    backedUp: boolean("backed_up").notNull(),
    aaguid: text("aaguid").notNull(),
    name: text("name").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    lastUsedAt: timestamptz("last_used_at"),
  },
  (table) => [
    index("passkeys_user_id_idx").on(table.userId),
    check(
      "passkeys_device_type_check",
      sql`${table.deviceType} IN ('singleDevice', 'multiDevice')`,
    ),
  ],
);
