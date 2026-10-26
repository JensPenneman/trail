import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

/** One advisory lock for everything that decides who an address belongs to. */
export const signupLockKey = 740_318_267;

/**
 * Serialises sign-ups with each other ("the first account ever created is
 * admin" holds under concurrency) and with new shares, which bind to the
 * address's account if it exists: a share is never left waiting for an
 * account created at the same moment. Held until the transaction ends.
 */
export async function lockSignups(tx: Executor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${signupLockKey})`);
}
