import { isIP } from "node:net";
import type { Logger } from "pino";
import type { Config } from "./config/config";
import { ConfigError, loadConfig } from "./config/loadConfig";
import { createAppContext } from "./createAppContext";
import { createPool } from "./db/createPool";
import { runMigrations } from "./db/runMigrations";
import { waitForDatabase } from "./db/waitForDatabase";
import { createApp } from "./http/createApp";
import { startJobs } from "./jobs/startJobs";
import { createLogger } from "./logging/createLogger";
import { runtimePaths } from "./runtimePaths";
import { listen } from "./server/listen";
import { shutdown } from "./server/shutdown";

process.setSourceMapsEnabled(true);

/** Hard stop if a graceful shutdown hangs (the container runtime would kill us anyway). */
const forcedExitMs = 13_000;
/** Slow statements are cut off; exports and tracks page through data instead. */
const statementTimeoutMs = 120_000;

async function start(config: Config, logger: Logger): Promise<void> {
  const paths = runtimePaths(import.meta.url);
  const pool = createPool(config.databaseUrl, logger, { statementTimeoutMs });
  await waitForDatabase(pool, logger, { attempts: 30, delayMs: 2_000 });
  await runMigrations(pool, paths.migrationsFolder);
  logger.info("database migrations applied");

  const ctx = createAppContext({ config, logger, pool });
  const server = await listen(createApp(ctx), config.port, config.host);
  const jobs = startJobs(ctx);
  logger.info(
    {
      port: config.port,
      host: config.host,
      publicUrl: config.publicUrl,
      ingestUrl: config.ingestUrl,
      version: config.build.version,
      commit: config.build.commit,
    },
    "Trail API listening",
  );
  if (isIP(new URL(config.publicUrl).hostname) !== 0) {
    logger.warn(
      "PUBLIC_URL is an IP address: browsers only allow passkeys on a domain or localhost",
    );
  }

  let stopping = false;
  const stop = (reason: string, exitCode: number) => {
    if (stopping) return;
    stopping = true;
    logger.info({ reason }, "shutting down");
    const forced = setTimeout(() => {
      logger.error("graceful shutdown timed out");
      process.exit(1);
    }, forcedExitMs);
    forced.unref();
    shutdown({ server, ctx, jobs })
      .then(() => {
        logger.info("stopped");
        process.exit(exitCode);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "shutdown failed");
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => stop("SIGTERM", 0));
  process.on("SIGINT", () => stop("SIGINT", 0));
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    stop("uncaught exception", 1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled promise rejection");
  });
}

let config: Config;
try {
  config = loadConfig(process.env, { webDistDir: runtimePaths(import.meta.url).webDistDir });
} catch (error) {
  const logger = createLogger({ level: "info" });
  if (error instanceof ConfigError) logger.fatal({ issues: error.issues }, "invalid configuration");
  else logger.fatal({ err: error }, "could not read the configuration");
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel, pretty: config.nodeEnv === "development" });
start(config, logger).catch((error: unknown) => {
  logger.fatal({ err: error }, "startup failed");
  process.exit(1);
});
