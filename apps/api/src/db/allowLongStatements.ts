import { sql } from "drizzle-orm";
import type { Executor } from "./database";

/**
 * Lifts the pool's per-statement limit for the rest of the current transaction
 * only. Deleting a device (cascade over its points) or rebuilding heat cells
 * can legitimately take minutes on years of 1 Hz data.
 */
export async function allowLongStatements(tx: Executor): Promise<void> {
  await tx.execute(sql`SET LOCAL statement_timeout = '15min'`);
}
