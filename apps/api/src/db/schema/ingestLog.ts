import { bigint, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/** One row per accepted Overland upload — the audit trail that data keeps arriving (90-day retention). */
export const ingestLog = pgTable(
  "ingest_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    records: integer("records").notNull(),
    locations: integer("locations").notNull(),
    duplicates: integer("duplicates").notNull(),
    visits: integer("visits").notNull(),
    trips: integer("trips").notNull(),
    events: integer("events").notNull(),
    rejected: integer("rejected").notNull(),
    durationMs: integer("duration_ms").notNull(),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("ingest_log_device_id_received_at_idx").on(table.deviceId, table.receivedAt.desc()),
  ],
);
