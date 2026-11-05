import { sql } from "drizzle-orm";
import type { Database, Executor, Transaction } from "../db/database";
import { errorCodes } from "../db/errorChain";
import { HttpError } from "../http/httpError";

/**
 * The per-device lock of processing (docs/architecture.md §17.4), held for the
 * rest of the transaction: one window of a device at a time, and a deletion
 * of points waits for the window that reads them.
 */
export async function lockDeviceProcessing(tx: Executor, deviceId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`trail.processing:${deviceId}`}, 0))`,
  );
}

/** What the person is told when the wait ran out (the web app shows it beside a retry). */
/** Seconds a client is told to wait before it repeats a correction that found the device busy. */
const retryAfterS = "5";

export const stillProcessingMessage = "Still processing this device's data, try again in a moment.";

/**
 * A transaction that takes the device's processing lock but waits for it only
 * `waitMs` (and for the rows it then locks, the same): a correction made while
 * a long pass runs answers `409` and a retry instead of hanging for the pass.
 */
export async function correctionTransaction<T>(
  db: Database,
  deviceId: string,
  waitMs: number,
  body: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('lock_timeout', ${`${waitMs}ms`}, true)`);
      await lockDeviceProcessing(tx, deviceId);
      return body(tx);
    });
  } catch (error) {
    // 55P03: lock_not_available, what `lock_timeout` raises.
    if (errorCodes(error).includes("55P03")) {
      throw new HttpError(409, "conflict", stillProcessingMessage, undefined, {
        "Retry-After": retryAfterS,
      });
    }
    throw error;
  }
}
