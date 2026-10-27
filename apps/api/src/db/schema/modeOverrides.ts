import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";
import { users } from "./users";

/**
 * Transport modes people set (docs/architecture.md §17.5): user data, kept
 * when segments are rebuilt and applied to them again. A `segment` override
 * covers its span; a `toggle` runs from `from_at` until `to_at`, the first
 * stop of ten minutes or more, or the first move of another kind of travel,
 * whichever comes first. Revoked rows stay for the record.
 */
export const modeOverrides = pgTable(
  "mode_overrides",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["segment", "toggle"] }).notNull(),
    fromAt: timestamptz("from_at").notNull(),
    toAt: timestamptz("to_at"),
    mode: text("mode").notNull(),
    source: text("source", { enum: ["ui", "api", "mcp"] }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
  },
  (table) => [
    index("mode_overrides_device_id_from_at_idx").on(table.deviceId, table.fromAt),
    check("mode_overrides_kind_check", sql`${table.kind} IN ('segment', 'toggle')`),
    check("mode_overrides_source_check", sql`${table.source} IN ('ui', 'api', 'mcp')`),
    check(
      "mode_overrides_mode_check",
      sql`${table.mode} IN ('stationary', 'walking', 'running', 'cycling', 'car', 'bus', 'tram', 'metro', 'train', 'boat', 'plane')`,
    ),
    check(
      "mode_overrides_span_check",
      sql`${table.toAt} IS NULL OR ${table.toAt} > ${table.fromAt}`,
    ),
  ],
);
