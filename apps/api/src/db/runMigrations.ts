import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

/** Arbitrary constant shared by every Trail process: only one of them migrates at a time. */
const migrationLockKey = 740_318_266;

/**
 * Applies pending drizzle-kit migrations under a Postgres advisory lock, so two
 * containers starting together (rolling update, CLI + server) never race.
 */
export async function runMigrations(pool: Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    // Building an index on a large table may take long; waiting for the lock too.
    await client.query("SET statement_timeout = 0");
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockKey]);
    try {
      await migrate(drizzle({ client }), { migrationsFolder });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [migrationLockKey]);
    }
  } finally {
    // The session setting must not leak into pooled clients: discard this connection.
    client.release(true);
  }
}
