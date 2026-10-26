import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/**
 * Whom a person has hidden on their People page (docs/architecture.md §5):
 * per person, not per share, so a new share from someone hidden arrives
 * hidden too, without a notice, until they are shown again.
 */
export const hiddenPeople = pgTable(
  "hidden_people",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hiddenUserId: uuid("hidden_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hiddenAt: timestamptz("hidden_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.hiddenUserId] })],
);
