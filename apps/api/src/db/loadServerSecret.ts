import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Executor } from "./database";
import { serverSecrets } from "./schema/serverSecrets";

/**
 * A key the server makes for itself the first time it needs it — 32 random
 * bytes — and keeps in `server_secrets` from then on: what it keys must stay
 * the same across restarts (docs/architecture.md §5). Concurrent first uses
 * agree on one key: the insert does nothing when another one won.
 */
export async function loadServerSecret(db: Executor, name: string): Promise<Buffer> {
  await db
    .insert(serverSecrets)
    .values({ name, secret: randomBytes(32) })
    .onConflictDoNothing({ target: serverSecrets.name });
  const [row] = await db
    .select({ secret: serverSecrets.secret })
    .from(serverSecrets)
    .where(eq(serverSecrets.name, name))
    .limit(1);
  if (row === undefined || row.secret.length < 32)
    throw new Error(`The server key ${name} is missing`);
  return row.secret;
}
