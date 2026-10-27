import { pgTable, text } from "drizzle-orm/pg-core";
import { bytea } from "../columns/bytea";
import { timestamptz } from "../columns/timestamptz";

/**
 * Random keys the server generates for itself on first use and keeps for good
 * (docs/architecture.md §5): `share-grid` keys the offsets of the sharing
 * grids, `data-access-visitor` the visitor keys of the data access log; both
 * must stay the same across restarts.
 */
export const serverSecrets = pgTable("server_secrets", {
  name: text("name").primaryKey(),
  secret: bytea("secret").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});
