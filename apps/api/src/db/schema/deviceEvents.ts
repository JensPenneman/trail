import { doublePrecision, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/** What the apps report besides points: Overland's log actions ("Include tracking stats"), OwnTracks' region transitions, heartbeats; geometry is optional. */
export const deviceEvents = pgTable(
  "device_events",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    recordedAt: timestamptz("recorded_at").notNull(),
    action: text("action").notNull(),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    extra: jsonb("extra").$type<Record<string, unknown>>(),
  },
  (table) => [
    primaryKey({
      name: "device_events_pkey",
      columns: [table.deviceId, table.recordedAt, table.action],
    }),
  ],
);
