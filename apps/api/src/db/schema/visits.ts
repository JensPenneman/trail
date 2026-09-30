import { doublePrecision, jsonb, pgTable, primaryKey, real, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/** iOS visits (CLVisit) reported by Overland; arrival and departure may arrive as separate records. */
export const visits = pgTable(
  "visits",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    recordedAt: timestamptz("recorded_at").notNull(),
    arrivedAt: timestamptz("arrived_at"),
    departedAt: timestamptz("departed_at"),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    horizontalAccuracy: real("horizontal_accuracy"),
    extra: jsonb("extra").$type<Record<string, unknown>>(),
  },
  (table) => [primaryKey({ name: "visits_pkey", columns: [table.deviceId, table.recordedAt] })],
);
