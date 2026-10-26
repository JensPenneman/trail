import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

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
