import { destination } from "pino";
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
  close(): Promise<void>;
}

/**
 * Configuration and a small pool for one command. Pending migrations are
 * applied first (under the same lock as the server), so commands also work
 * before the server has ever started. Logs go to stderr: stdout is the output.
 */
export async function openCliContext(entryUrl: string): Promise<CliContext> {
  const paths = runtimePaths(entryUrl);
  const config = loadConfig(process.env, { webDistDir: paths.webDistDir });
  const verbose = config.logLevel === "debug" || config.logLevel === "trace";
  const logger = createLogger({
    level: verbose ? config.logLevel : "warn",
    destination: destination(2),
  });
  const pool = createPool(config.databaseUrl, logger, { statementTimeoutMs: 0, max: 2 });
  try {
    await runMigrations(pool, paths.migrationsFolder);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return { config, db: createDatabase(pool), close: () => pool.end() };
}
