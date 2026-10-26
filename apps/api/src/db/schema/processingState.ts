import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";

/** Small facts about processing that must outlive a restart: the version the history was backfilled for. */
export const processingState = pgTable("processing_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});
