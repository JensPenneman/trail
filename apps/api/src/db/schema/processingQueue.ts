import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/**
 * Windows of history waiting to be processed (docs/architecture.md §17.4): a
 * table, so a restart loses nothing. Priority 0 is new data, 1 repair, 2 the
 * backfill. `missing_tiles` lists the map tiles a processed window still
 * waits for.
 */
export const processingQueue = pgTable(
  "processing_queue",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    fromAt: timestamptz("from_at").notNull(),
    toAt: timestamptz("to_at").notNull(),
    reason: text("reason").notNull(),
    fromLevel: text("from_level", { enum: ["averaged", "mapped", "inferred"] })
      .notNull()
      .default("averaged"),
    priority: smallint("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    nextAt: timestamptz("next_at").notNull().defaultNow(),
    enqueuedAt: timestamptz("enqueued_at").notNull().defaultNow(),
    missingTiles: jsonb("missing_tiles").$type<string[]>(),
    lastError: text("last_error"),
  },
  (table) => [
    primaryKey({ name: "processing_queue_pkey", columns: [table.deviceId, table.fromAt] }),
    index("processing_queue_priority_next_at_idx").on(table.priority, table.nextAt),
    check(
      "processing_queue_from_level_check",
      sql`${table.fromLevel} IN ('averaged', 'mapped', 'inferred')`,
    ),
    check("processing_queue_span_check", sql`${table.toAt} > ${table.fromAt}`),
  ],
);
