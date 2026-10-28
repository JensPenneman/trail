import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";

/**
 * The heartbeats of the processing workers (docs/architecture.md §17.4): one
 * row per worker process, refreshed every 15 seconds while it runs and pruned
 * an hour after it was last seen. `id` names the host, the process and its
 * start; `passes` and `points` count since that start; `job_id` is the job a
 * worker is running, for the job table to come (null until jobs have ids).
 * No user data: the API reads it to tell whether a worker is up.
 */
export const processingWorkers = pgTable("processing_workers", {
  id: text("id").primaryKey(),
  startedAt: timestamptz("started_at").notNull(),
  lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
  version: text("version").notNull(),
  jobId: bigint("job_id", { mode: "number" }),
  passes: bigint("passes", { mode: "number" }).notNull().default(0),
  points: bigint("points", { mode: "number" }).notNull().default(0),
});
