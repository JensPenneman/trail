import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/**
 * The points. The primary key is the natural dedupe: Overland has 1 s timestamps
 * and re-sends whole batches it never got an ack for.
 */
export const locations = pgTable(
  "locations",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    recordedAt: timestamptz("recorded_at").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    altitude: real("altitude"),
    speed: real("speed"),
    course: real("course"),
    horizontalAccuracy: real("horizontal_accuracy"),
    verticalAccuracy: real("vertical_accuracy"),
    speedAccuracy: real("speed_accuracy"),
    courseAccuracy: real("course_accuracy"),
    motion: text("motion").array().notNull().default(sql`'{}'::text[]`),
    batteryLevel: real("battery_level"),
    batteryState: text("battery_state"),
    wifi: text("wifi"),
    /** Every Overland property without a column (tracking stats, unique_id, …). */
    extra: jsonb("extra").$type<Record<string, unknown>>(),
  },
  (table) => [
    primaryKey({ name: "locations_pkey", columns: [table.deviceId, table.recordedAt] }),
    index("locations_received_at_brin").using("brin", table.receivedAt),
  ],
);
