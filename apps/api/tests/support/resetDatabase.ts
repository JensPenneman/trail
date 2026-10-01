import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseName } from "../../src/config/databaseName";
import { runMigrations } from "../../src/db/runMigrations";
import { testDatabaseUrl } from "./testEnvironment";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Empties the test database: no tables, no migration history. */
export async function wipeTestDatabase(pool: pg.Pool): Promise<void> {
  const name = databaseName(testDatabaseUrl) ?? "";
  // Wiping a schema is only ever allowed on a dedicated test database.
  if (!/^trail.*test/.test(name)) {
    throw new Error(
      `Refusing to reset "${name}": TEST_DATABASE_URL must name a trail…test database`,
    );
  }
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/** Drops and recreates the test schema, then applies the real migrations. */
export async function resetDatabase(): Promise<void> {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  try {
    await wipeTestDatabase(pool);
    await runMigrations(pool, migrationsFolder);
  } finally {
    await pool.end();
  }
}
