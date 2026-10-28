import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

const chosenModes =
  "'stationary', 'walking', 'running', 'cycling', 'car', 'bus', 'tram', 'metro', 'train', 'boat', 'plane'";
const modes = sql.raw(`${chosenModes}, 'unknown'`);

/**
 * The inferred level: stops and moves with their transport modes
 * (docs/architecture.md §17.2). Derived and rebuilt per window; a segment
 * keeps its id while it keeps its start. `mode` is the one that counts
 * (`mode_user`, else `mode_inferred`); `review` says the inference was unsure.
 */
export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    startedAt: timestamptz("started_at").notNull(),
    endedAt: timestamptz("ended_at").notNull(),
    kind: text("kind", { enum: ["stop", "move"] }).notNull(),
    mode: text("mode"),
    modeInferred: text("mode_inferred"),
    modeUser: text("mode_user"),
    confidence: real("confidence"),
    review: boolean("review").notNull().default(false),
    distanceM: doublePrecision("distance_m").notNull(),
    durationS: integer("duration_s").notNull(),
    maxSpeed: real("max_speed"),
    pointCount: integer("point_count").notNull(),
    startLat: doublePrecision("start_lat").notNull(),
    startLon: doublePrecision("start_lon").notNull(),
    endLat: doublePrecision("end_lat").notNull(),
    endLon: doublePrecision("end_lon").notNull(),
    centroidLat: doublePrecision("centroid_lat").notNull(),
    centroidLon: doublePrecision("centroid_lon").notNull(),
    /** A move's: what the mode was judged on, the scores, and the override that applies; a stop's: `spreadM`. */
    features: jsonb("features").$type<Record<string, unknown>>().notNull(),
    version: smallint("version").notNull(),
    computedAt: timestamptz("computed_at").notNull().defaultNow(),
  },
  (table) => [
    unique("segments_device_id_started_at_key").on(table.deviceId, table.startedAt),
    index("segments_device_id_ended_at_idx").on(table.deviceId, table.endedAt),
    // The API's catch-up after a lost listening connection reads by it (docs/architecture.md §9).
    index("segments_computed_at_idx").on(table.computedAt),
    check("segments_kind_check", sql`${table.kind} IN ('stop', 'move')`),
    check("segments_mode_check", sql`${table.mode} IN (${modes})`),
    check("segments_mode_inferred_check", sql`${table.modeInferred} IN (${modes})`),
    check("segments_mode_user_check", sql`${table.modeUser} IN (${sql.raw(chosenModes)})`),
  ],
);
