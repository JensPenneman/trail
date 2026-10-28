import type { PoolClient } from "pg";

/** Arbitrary constant shared by every Trail process: one map import at a time on a database. */
const importLockKey = 740_318_301;

/** Takes the import lock for the client's session; false when another session holds it. */
export async function lockImports(client: PoolClient): Promise<boolean> {
  const locked = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [importLockKey],
  );
  return locked.rows[0]?.locked === true;
}

/** Lets the next import in; a broken connection lets go of the lock by itself. */
export const unlockImports = (client: PoolClient): Promise<unknown> =>
  client.query("SELECT pg_advisory_unlock($1)", [importLockKey]).catch(() => undefined);
