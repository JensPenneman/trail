import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";

/**
 * A worker whose newest heartbeat is older than this is down — six beats of
 * 15 s missed: to the API (`/api/health`, by the database's clock) and to its
 * own liveness probe (`/health/live`, docs/architecture.md §3).
 */
export const heartbeatStaleS = 90;

/** What a worker tells of itself with every heartbeat (docs/architecture.md §17.4). */
export interface WorkerBeat {
  id: string;
  startedAt: Date;
  version: string;
  /** The job it is running; null while idle, and until jobs have ids of their own. */
  jobId: number | null;
  /** Passes done since the start. */
  passes: number;
  /** Raw points those passes read. */
  points: number;
}

/** A worker as the API sees it: its last heartbeat, by the database's clock. */
export interface WorkerHeartbeat extends WorkerBeat {
  lastSeenAt: Date;
}

interface HeartbeatRow extends Record<string, unknown> {
  id: string;
  started_at: string;
  last_seen_at: string;
  version: string;
  job_id: string | null;
  passes: string;
  points: string;
}

/**
 * A worker's id: its host (a container's own), its process and its start, and
 * a random tag, since one process may run two loops (the tests do).
 */
export function workerId(startedAt: Date): string {
  return `${hostname()}:${process.pid}:${startedAt.toISOString()}:${randomBytes(2).toString("hex")}`;
}

/** Writes a heartbeat: the first creates the worker's row, every later one refreshes it. */
export async function writeHeartbeat(db: Executor, beat: WorkerBeat): Promise<void> {
  await db.execute(sql`
    INSERT INTO processing_workers (id, started_at, last_seen_at, version, job_id, passes, points)
    VALUES (${beat.id}, ${beat.startedAt.toISOString()}::timestamptz, now(), ${beat.version},
      ${beat.jobId}, ${beat.passes}, ${beat.points})
    ON CONFLICT (id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at, version = excluded.version, job_id = excluded.job_id,
      passes = excluded.passes, points = excluded.points
  `);
}

/** The workers that beat within the last hour or so (older rows are pruned), the latest first. */
export async function readHeartbeats(db: Executor): Promise<WorkerHeartbeat[]> {
  const result = await db.execute<HeartbeatRow>(sql`
    SELECT id, started_at::text, last_seen_at::text, version, job_id::text, passes::text, points::text
    FROM processing_workers
    ORDER BY last_seen_at DESC, id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    startedAt: new Date(toIso(row.started_at)),
    lastSeenAt: new Date(toIso(row.last_seen_at)),
    version: row.version,
    jobId: row.job_id === null ? null : Number(row.job_id),
    passes: Number(row.passes),
    points: Number(row.points),
  }));
}
