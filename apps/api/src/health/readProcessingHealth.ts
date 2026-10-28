import type { ProcessingHealth } from "@trail/contracts/health";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { heartbeatStaleS } from "../worker/workerHeartbeats";

/** Queued windows are counted up to this many, so the summary costs the same however long the queue. */
export const queuedCountLimit = 10_000;

interface SummaryRow extends Record<string, unknown> {
  up: boolean | null;
  last_seen_s: number | null;
  queued: number;
}

/**
 * The processing summary of `/api/health` (docs/architecture.md §8), in one
 * statement: whether a worker beat within the last 90 s and how long ago the
 * newest heartbeat was — both from `last_seen_at` against the database's own
 * `now()`, the clock that wrote it, never a process's clock (`started_at` is
 * the worker's) — and how many windows wait in the queue. It reads the few
 * rows of `processing_workers` and at most 10 000 entries of the queue, and
 * returns counts only: a heartbeat's id names a host and a process.
 */
export async function readProcessingHealth(
  db: Executor,
  options: { enabled: boolean },
): Promise<ProcessingHealth> {
  const result = await db.execute<SummaryRow>(sql`
    SELECT
      max(last_seen_at) > now() - make_interval(secs => ${heartbeatStaleS}) AS up,
      floor(extract(epoch FROM now() - max(last_seen_at)))::int AS last_seen_s,
      (SELECT count(*)::int FROM (SELECT 1 FROM processing_queue LIMIT ${queuedCountLimit}) AS q) AS queued
    FROM processing_workers
  `);
  const row = result.rows[0];
  const lastSeenS = row?.last_seen_s ?? null;
  return {
    worker: !options.enabled ? "none" : row?.up === true ? "up" : "down",
    // The database's clock can step back (NTP): an age is never negative.
    lastSeenS: lastSeenS === null ? null : Math.max(0, lastSeenS),
    queued: row?.queued ?? 0,
  };
}
