import { bigint, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { devices } from "./devices";

/** Dead letter for invalid records of any app — never silently drop data (kept forever, like every recorded row). */
export const ingestRejects = pgTable(
  "ingest_rejects",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    reason: text("reason").notNull(),
    record: jsonb("record"),
  },
  (table) => [
    index("ingest_rejects_device_id_received_at_idx").on(table.deviceId, table.receivedAt),
    index("ingest_rejects_received_at_idx").on(table.receivedAt),
  ],
);
