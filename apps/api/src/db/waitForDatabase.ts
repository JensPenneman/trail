import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";
import type { Logger } from "pino";
import { isDatabaseUnavailable } from "./isDatabaseUnavailable";

/**
 * Waits until Postgres accepts queries. After a host reboot the app container
 * may start before the database is ready; failing fast would only cause a
 * restart loop.
 */
export async function waitForDatabase(
  pool: Pool,
  logger: Logger,
  options: { attempts: number; delayMs: number },
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (!isDatabaseUnavailable(error) || attempt >= options.attempts) throw error;
      logger.warn({ attempt, err: error }, "database not reachable yet, retrying");
      await sleep(options.delayMs);
    }
  }
}
