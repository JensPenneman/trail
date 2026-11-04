import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

const modes = sql.raw(
  "'stationary', 'walking', 'running', 'cycling', 'car', 'bus', 'tram', 'metro', 'train', 'boat', 'plane', 'unknown'",
);

/**
 * Per local day and cell of three levels (12, 15, 18): the points of a device and the time it
 * moved there, derived from the processed points and the segments' modes
 * (docs/architecture.md §5, `rebuildHeatDays`). `mode` is the move's, `stationary` in a stop and
 * `unknown` outside any segment; `move_s` sums the intervals to the next kept point inside a move
 * (at most 600 s each), `speed_s` the speed times those seconds.
 */
export const heatDays = pgTable(
  "heat_days",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    z: smallint("z").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    mode: text("mode").notNull(),
    points: integer("points").notNull(),
    moveS: integer("move_s").notNull(),
    distanceM: real("distance_m").notNull(),
    speedS: real("speed_s").notNull(),
    maxSpeed: real("max_speed"),
    computedAt: timestamptz("computed_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "heat_days_pkey",
      columns: [table.deviceId, table.z, table.x, table.y, table.day, table.mode],
    }),
    index("heat_days_device_day_idx").on(table.deviceId, table.day),
    check("heat_days_mode_check", sql`${table.mode} IN (${modes})`),
  ],
);
