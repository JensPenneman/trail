import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

export interface PruneResult {
  sessions: number;
  ceremonies: number;
  passkeyLinks: number;
  invites: number;
  ingestLog: number;
  ingestRejects: number;
}

/**
 * Retention (docs/architecture.md §10): expired sessions and ceremonies go
 * immediately, used or expired links and invites after 30 days (so the admin
 * list still shows recent ones), upload logs after 90 days, rejects after 30.
 */
export async function pruneExpiredData(db: Executor): Promise<PruneResult> {
  const count = async (statement: ReturnType<typeof sql>) =>
    (await db.execute(statement)).rowCount ?? 0;
  return {
    sessions: await count(sql`DELETE FROM sessions WHERE expires_at < now()`),
    ceremonies: await count(sql`DELETE FROM auth_ceremonies WHERE expires_at < now()`),
    passkeyLinks: await count(sql`
      DELETE FROM passkey_links
      WHERE used_at < now() - interval '30 days' OR expires_at < now() - interval '30 days'
    `),
    invites: await count(sql`
      DELETE FROM invites
      WHERE used_at < now() - interval '30 days' OR expires_at < now() - interval '30 days'
    `),
    ingestLog: await count(
      sql`DELETE FROM ingest_log WHERE received_at < now() - interval '90 days'`,
    ),
    ingestRejects: await count(
      sql`DELETE FROM ingest_rejects WHERE received_at < now() - interval '30 days'`,
    ),
  };
}
