import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  jsonb,
  pgTable,
  real,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

/** Shape of `devices.live_trip`: the trip in progress on the phone (Overland's top-level `trip`). */
export interface StoredLiveTrip {
  mode: string;
  startedAt: string;
  distanceM: number;
}

/** Trackers (Overland installs). Caches the latest position and battery so the dashboard never scans points. */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source", { enum: ["overland"] })
      .notNull()
      .default("overland"),
    /** The Overland "Device ID". */
    deviceKey: text("device_key").notNull(),
    tokenHash: text("token_hash").notNull().unique("devices_token_hash_key"),
    tokenHint: text("token_hint").notNull(),
    alertsEnabled: boolean("alerts_enabled").notNull().default(true),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    /** Last accepted upload of any record kind. */
    lastSeenAt: timestamptz("last_seen_at"),
    lastRecordedAt: timestamptz("last_recorded_at"),
    lastLat: doublePrecision("last_lat"),
    lastLon: doublePrecision("last_lon"),
    lastAccuracy: real("last_accuracy"),
    lastSpeed: real("last_speed"),
    lastAltitude: real("last_altitude"),
    lastCourse: real("last_course"),
    lastMotion: text("last_motion").array(),
    batteryLevel: real("battery_level"),
    batteryState: text("battery_state"),
    batteryRecordedAt: timestamptz("battery_recorded_at"),
    liveTrip: jsonb("live_trip").$type<StoredLiveTrip>(),
    pointsTotal: bigint("points_total", { mode: "number" }).notNull().default(0),
    /** Remote-settings preset sent once with the next ingest response. */
    pendingSettings: text("pending_settings", {
      enum: ["balanced", "high-resolution", "battery-saver"],
    }),
    settingsAppliedAt: timestamptz("settings_applied_at"),
    staleAlertedAt: timestamptz("stale_alerted_at"),
  },
  (table) => [
    unique("devices_user_id_device_key_key").on(table.userId, table.deviceKey),
    check("devices_source_check", sql`${table.source} IN ('overland')`),
    check(
      "devices_pending_settings_check",
      sql`${table.pendingSettings} IN ('balanced', 'high-resolution', 'battery-saver')`,
    ),
  ],
);
