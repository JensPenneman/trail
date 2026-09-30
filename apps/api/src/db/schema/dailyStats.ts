import { date, doublePrecision, integer, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/** Per-day totals; `date` is the calendar day in the owner's time zone. */
export const dailyStats = pgTable(
  "daily_stats",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    points: integer("points").notNull(),
    distanceM: doublePrecision("distance_m").notNull(),
    firstAt: timestamptz("first_at").notNull(),
    lastAt: timestamptz("last_at").notNull(),
  },
  (table) => [primaryKey({ name: "daily_stats_pkey", columns: [table.deviceId, table.date] })],
);
