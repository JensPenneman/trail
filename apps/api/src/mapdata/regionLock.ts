import type { Pool } from "pg";

const lockKey = (region: string): string => `trail.map:${region}`;

/**
 * Runs `task` while this process holds the region's refresh lock, a Postgres
 * advisory lock on a connection of its own: the worker's schedule and a
 * `trail map refresh` in another process never pull or import one region at
 * once, and a process that dies lets go of it with its connection. `task`
 * gets `false`, and runs without the lock, when another process holds it.
 */
export async function withRegionLock<T>(
  pool: Pool,
  region: string,
  task: (locked: boolean) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [lockKey(region)],
    );
    if (rows[0]?.locked !== true) return await task(false);
    try {
      return await task(true);
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey(region)])
        .catch((error: unknown) => {
          // Closing the connection lets go of the lock as well.
          broken = error instanceof Error ? error : new Error(String(error));
        });
    }
  } finally {
    client.release(broken);
  }
}
