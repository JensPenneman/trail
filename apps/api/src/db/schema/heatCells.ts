import { integer, pgTable, primaryKey, smallint, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/** Pre-aggregated all-time point density per slippy-map tile, maintained by the ingest statement. */
export const heatCells = pgTable(
  "heat_cells",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    z: smallint("z").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    count: integer("count").notNull(),
    firstAt: timestamptz("first_at").notNull(),
    lastAt: timestamptz("last_at").notNull(),
  },
  (table) => [
    primaryKey({ name: "heat_cells_pkey", columns: [table.deviceId, table.z, table.x, table.y] }),
  ],
);
