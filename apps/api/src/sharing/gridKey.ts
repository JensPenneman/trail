import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Executor } from "../db/database";
import { serverSecrets } from "../db/schema/serverSecrets";

const name = "share-grid";

/**
 * The key of the sharing grids, created the first time it is needed and kept
 * in the database: a new key would move every grid, and a recipient who saw
 * both could intersect old and new cells.
 */
export async function loadGridKey(db: Executor): Promise<Buffer> {
  await db
    .insert(serverSecrets)
    .values({ name, secret: randomBytes(32) })
    .onConflictDoNothing({ target: serverSecrets.name });
  const [row] = await db
    .select({ secret: serverSecrets.secret })
    .from(serverSecrets)
    .where(eq(serverSecrets.name, name))
    .limit(1);
  if (row === undefined || row.secret.length < 32) throw new Error("The share grid key is missing");
  return row.secret;
}
