import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/** Trips recorded with Overland's Start/Stop button. */
export const trips = pgTable(
  "trips",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    startedAt: timestamptz("started_at").notNull(),
    endedAt: timestamptz("ended_at").notNull(),
    mode: text("mode").notNull(),
    distanceM: doublePrecision("distance_m"),
    durationS: doublePrecision("duration_s"),
    steps: integer("steps"),
    stoppedAutomatically: boolean("stopped_automatically").notNull().default(false),
    startLocation: jsonb("start_location"),
    endLocation: jsonb("end_location"),
    extra: jsonb("extra").$type<Record<string, unknown>>(),
  },
  (table) => [primaryKey({ name: "trips_pkey", columns: [table.deviceId, table.startedAt] })],
);
