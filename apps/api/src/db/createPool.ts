import pg from "pg";
import type { Logger } from "pino";

export interface PoolOptions {
  /** Per-statement limit; 0 disables it (CLI maintenance commands). */
  statementTimeoutMs: number;
  max?: number;
}

/**
 * The single connection pool. Sessions run in UTC so raw `timestamptz` text is
 * unambiguous, and an idle-client error is logged instead of crashing the
 * process (pg emits it on the pool when the server drops a connection).
 */
export function createPool(
  connectionString: string,
  logger: Logger,
  options: PoolOptions,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "trail",
    options: "-c TimeZone=UTC",
    ...(options.statementTimeoutMs > 0 ? { statement_timeout: options.statementTimeoutMs } : {}),
    idle_in_transaction_session_timeout: 60_000,
  });
  pool.on("error", (error) => {
    logger.error({ err: error }, "idle database connection failed");
  });
  return pool;
}
