import { date, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/**
 * The local days of a device whose per-day heat cells (`heat_days`) are to be made again
 * (docs/architecture.md §8.2): a pass marks the days it touched in its own transaction, the
 * scheduler rebuilds them apart from it and deletes the marks it has served, so that a crash, a
 * kill or a failed rebuild loses none. A mark made again while a rebuild runs (`marked_at` moves)
 * survives it.
 */
export const heatDayMarks = pgTable(
  "heat_day_marks",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    markedAt: timestamptz("marked_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "heat_day_marks_pkey", columns: [table.deviceId, table.day] })],
);
