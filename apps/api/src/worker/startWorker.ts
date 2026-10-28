import type { Logger } from "pino";
import type { Config } from "../config/config";
import { createPool } from "../db/createPool";
import { createDatabase } from "../db/database";
import { runMigrations } from "../db/runMigrations";
import { waitForDatabase } from "../db/waitForDatabase";
import { createWorkerLoop } from "./createWorkerLoop";
import { type LivenessProbe, startLivenessServer } from "./livenessServer";
import type { WorkerLoop } from "./workerLoop";

/** A pass's statements are cut off after two minutes, as the server's are. */
const statementTimeoutMs = 120_000;
/** A pass holds one connection; the tile fetcher, the heartbeat and the periodic passes the rest. */
const poolSize = 5;

export interface StartedWorker {
  loop: WorkerLoop;
  /** Takes no more work, lets the pass in progress commit, writes the last heartbeat, closes the probe and the pool. */
  stop(): Promise<void>;
}

/**
 * The worker process (docs/architecture.md §3), without an HTTP server: it
 * waits for the database, applies pending migrations under the same lock as
 * the server (whichever starts first migrates; the other finds nothing to
 * do) and starts the loop — the passes, the map tiles, the backfill and the
 * 15-minute pass, with a heartbeat every 15 seconds. Its liveness probe on
 * PROCESSING_METRICS_PORT (`/health/live`, its container's health check)
 * opens first: a port in use fails the start before any work, and the probe
 * says `starting` until the loop beats, so a long migration fails no check.
 */
export async function startWorker(input: {
  config: Config;
  logger: Logger;
  migrationsFolder: string;
}): Promise<StartedWorker> {
  const { config, logger } = input;
  const { metricsPort } = config.processing;
  const probe: LivenessProbe | null =
    metricsPort > 0 ? await startLivenessServer({ port: metricsPort, host: config.host }) : null;
  const pool = createPool(config.databaseUrl, logger, {
    statementTimeoutMs,
    max: poolSize,
    applicationName: "trail-worker",
  });
  try {
    await waitForDatabase(pool, logger, { attempts: 30, delayMs: 2_000 });
    await runMigrations(pool, input.migrationsFolder);
  } catch (error) {
    await pool.end();
    await probe?.close();
    throw error;
  }
  logger.info("database migrations applied");
  const loop = createWorkerLoop({ config, logger, db: createDatabase(pool), pollReady: true });
  await loop.start();
  probe?.watch(loop);
  logger.info(
    {
      worker: loop.id,
      version: config.build.version,
      commit: config.build.commit,
      processing: config.processing.enabled,
      livenessPort: probe?.port ?? null,
    },
    "Trail worker started",
  );
  if (!config.processing.enabled) {
    logger.warn("processing is switched off (PROCESSING_ENABLED=false): the worker only beats");
  }
  return {
    loop,
    async stop() {
      await loop.stop();
      await probe?.close();
      await pool.end();
    },
  };
}
