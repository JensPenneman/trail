import type { Logger } from "pino";
import type { Database } from "../db/database";
import { sweepBuildTables } from "./buildPartitions";
import { lockImports, unlockImports } from "./importLock";

/**
 * Removes what a crash left of builds no region references any more
 * (`sweepBuildTables`), unless an import is running, which sweeps for itself:
 * at the processing worker's start, as every import does at its own start
 * and end (docs/design/self-hosted-maps.md §2.6).
 */
export async function sweepMapBuilds(db: Database, logger: Logger): Promise<string[]> {
  const client = await db.$client.connect();
  try {
    await client.query("SET statement_timeout = 0");
    if (!(await lockImports(client))) return [];
    try {
      return await sweepBuildTables(client, logger);
    } finally {
      await unlockImports(client);
    }
  } finally {
    // The session's setting must not reach the pool's other users.
    client.release(true);
  }
}
