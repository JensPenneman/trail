import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { locations } from "./locations";

/**
 * The averaged and mapped levels of each point (docs/architecture.md §17.2),
 * derived and rebuildable: deleting a point deletes its row. `lat_map` null =
 * not mapped (no map data yet, or mapping switched off).
 */
export const processedPoints = pgTable(
  "processed_points",
  {
    deviceId: uuid("device_id").notNull(),
    recordedAt: timestamptz("recorded_at").notNull(),
    /** False for points dropped as inaccurate or as a spike. */
    kept: boolean("kept").notNull(),
    latAvg: doublePrecision("lat_avg").notNull(),
    lonAvg: doublePrecision("lon_avg").notNull(),
    speedAvg: real("speed_avg"),
    latMap: doublePrecision("lat_map"),
    lonMap: doublePrecision("lon_map"),
    wayId: bigint("way_id", { mode: "number" }),
    wayKind: text("way_kind"),
    snapM: real("snap_m"),
    /** The way's shape since the previous point of its move: `[[lon, lat], …]`, both ends excluded. */
    pathMap: jsonb("path_map").$type<[number, number][]>(),
    version: smallint("version").notNull(),
    processedAt: timestamptz("processed_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "processed_points_pkey", columns: [table.deviceId, table.recordedAt] }),
    foreignKey({
      name: "processed_points_location_fkey",
      columns: [table.deviceId, table.recordedAt],
      foreignColumns: [locations.deviceId, locations.recordedAt],
    }).onDelete("cascade"),
  ],
);
