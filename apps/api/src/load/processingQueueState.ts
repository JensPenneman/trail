import { sql } from "drizzle-orm";
import type { Database } from "../db/database";

interface QueueStateRow extends Record<string, unknown> {
  queued: number;
  ready: number;
  oldest_ready_s: number | null;
}

/**
 * The processing queue at a glance, for the load line: its rows, the new-data
 * windows ready to run, and how long the oldest of those has waited since it
 * was queued (`enqueued_at`; docs/design/capacity.md §6.3) — new data waiting
 * for its pass, not how late the worker is past a window's `next_at`, which a
 * deliberate delay before the pass would hide. One small aggregate a minute.
 */
export async function processingQueueState(
  db: Database,
): Promise<{ queued: number; ready: number; oldestReadyS: number | null }> {
  const result = await db.execute<QueueStateRow>(sql`
    SELECT count(*)::int AS queued,
      count(*) FILTER (WHERE priority = 0 AND next_at <= now())::int AS ready,
      extract(epoch FROM now() - min(enqueued_at) FILTER (WHERE priority = 0 AND next_at <= now()))::float8
        AS oldest_ready_s
    FROM processing_queue
  `);
  const row = result.rows[0];
  return {
    queued: row?.queued ?? 0,
    ready: row?.ready ?? 0,
    oldestReadyS: row?.oldest_ready_s ?? null,
  };
}
