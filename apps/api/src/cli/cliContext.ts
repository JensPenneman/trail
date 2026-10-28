import type { Pool } from "pg";
import { destination, type Logger } from "pino";
import type { Config } from "../config/config";
import { loadConfig } from "../config/loadConfig";
import { createPool } from "../db/createPool";
import { createDatabase, type Database } from "../db/database";
import { runMigrations } from "../db/runMigrations";
import { createLogger } from "../logging/createLogger";
import { runtimePaths } from "../runtimePaths";

export interface CliContext {
  config: Config;
  db: Database;
  /** Warnings and errors on stderr (everything with LOG_LEVEL=debug). */
  logger: Logger;
  close(): Promise<void>;
}

/**
 * Configuration and a small pool for one command. Pending migrations are
 * applied first (under the same lock as the server), so commands also work
 * before the server has ever started; a command's `preflight` sees the
 * configuration before the database is opened and its `beforeMigrations` the
 * database before it is migrated, and either may refuse. Logs go to stderr:
 * stdout is the output.
 */
export async function openCliContext(
  entryUrl: string,
  checks: {
    preflight?: ((config: Config) => void) | undefined;
    beforeMigrations?: ((pool: Pool) => Promise<void>) | undefined;
  } = {},
): Promise<CliContext> {
  const paths = runtimePaths(entryUrl);
  const config = loadConfig(process.env, { webDistDir: paths.webDistDir });
  checks.preflight?.(config);
  const verbose = config.logLevel === "debug" || config.logLevel === "trace";
  const logger = createLogger({
    level: verbose ? config.logLevel : "warn",
    destination: destination(2),
  });
  const pool = createPool(config.databaseUrl, logger, { statementTimeoutMs: 0, max: 2 });
  try {
    await checks.beforeMigrations?.(pool);
    await runMigrations(pool, paths.migrationsFolder);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return { config, db: createDatabase(pool), logger, close: () => pool.end() };
}
