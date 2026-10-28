import type { Pool } from "pg";
import type { DestinationStream, Logger } from "pino";
import type { Config, LogLevel } from "../../src/config/config";
import { loadConfig } from "../../src/config/loadConfig";
import { createPool } from "../../src/db/createPool";
import { createDatabase, type Database } from "../../src/db/database";
import { createLogger } from "../../src/logging/createLogger";
import type { WaySource } from "../../src/processing/waySource";
import { createWorkerLoop } from "../../src/worker/createWorkerLoop";
import type { WorkerLoop } from "../../src/worker/workerLoop";
import { testEnvironment } from "./testEnvironment";

export interface WorkerContext {
  config: Config;
  logger: Logger;
  pool: Pool;
  db: Database;
  /** The worker: `loop.flush()` runs every ready pass and fetches map tiles, `loop.start()` its timers. */
  loop: WorkerLoop;
  close(): Promise<void>;
}

/**
 * A worker process's side without the HTTP app (docs/architecture.md §3),
 * wired to the test database in role `worker`: one test can hold an API
 * context (`createTestContext`, role `api`) and a worker context on one
 * database. Nothing runs on its own until `loop.start()`; tests flush.
 */
export async function createWorkerContext(
  options: {
    env?: Record<string, string>;
    /** Map data for processing (default: none, so the mapped level degrades to averaged). */
    waySource?: WaySource | null;
    /** Receives the worker's log lines instead of discarding them … */
    logDestination?: DestinationStream;
    /** … from this level on (info by default). */
    logLevel?: LogLevel;
  } = {},
): Promise<WorkerContext> {
  const config = loadConfig(testEnvironment({ PROCESSING_ROLE: "worker", ...options.env }), {
    webDistDir: "/nonexistent/web/dist",
  });
  const logger =
    options.logDestination === undefined
      ? createLogger({ level: "silent" })
      : createLogger({ level: options.logLevel ?? "info", destination: options.logDestination });
  const pool = createPool(config.databaseUrl, logger, {
    statementTimeoutMs: 30_000,
    max: 5,
    applicationName: "trail-worker",
  });
  const db = createDatabase(pool);
  const loop = createWorkerLoop({
    config,
    logger,
    db,
    pollReady: true,
    waySource: options.waySource ?? null,
    // Tests flush the queue explicitly.
    delayMs: 3_600_000,
  });
  return {
    config,
    logger,
    pool,
    db,
    loop,
    async close() {
      await loop.stop();
      await pool.end();
    },
  };
}
