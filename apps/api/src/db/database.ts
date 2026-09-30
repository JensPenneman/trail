import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export type Database = NodePgDatabase & { $client: Pool };

/** The handle passed to a `db.transaction` callback; its own `transaction` opens a savepoint. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything that can run queries: the pooled database or an open transaction. */
export type Executor = Database | Transaction;

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool });
}
