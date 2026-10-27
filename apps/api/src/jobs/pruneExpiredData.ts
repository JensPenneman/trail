import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

export interface PruneResult {
  sessions: number;
  ceremonies: number;
  passkeyLinks: number;
  invites: number;
  apiTokens: number;
  shares: number;
  shareLinks: number;
  ingestLog: number;
  dataAccessEvents: number;
}

/**
 * Retention (docs/architecture.md §10): expired sessions and ceremonies go
 * immediately, used or expired links and invites and revoked or expired API
 * tokens after 30 days (so the lists still show recent ones), stopped or ended
 * shares and share links after 30 days, upload logs after 90 days, the hours
 * of the data access log after `dataAccessRetentionDays` (a log, not location
 * data). Recorded data is never pruned: points, visits, trips, events and the
 * dead letter of rejected records (raw phone data that may still be
 * recovered) are kept forever.
 */
export async function pruneExpiredData(
  db: Executor,
  retention: { dataAccessRetentionDays: number },
): Promise<PruneResult> {
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
    apiTokens: await count(sql`
      DELETE FROM api_tokens
      WHERE revoked_at < now() - interval '30 days' OR expires_at < now() - interval '30 days'
    `),
    shares: await count(sql`
      DELETE FROM shares
      WHERE revoked_at < now() - interval '30 days' OR expires_at < now() - interval '30 days'
    `),
    shareLinks: await count(sql`
      DELETE FROM share_links
      WHERE revoked_at < now() - interval '30 days' OR expires_at < now() - interval '30 days'
    `),
    ingestLog: await count(
      sql`DELETE FROM ingest_log WHERE received_at < now() - interval '90 days'`,
    ),
    // By the hour's start, which the unique key holds after the owner: PostgreSQL 18 skips through it.
    dataAccessEvents: await count(sql`
      DELETE FROM data_access_events
      WHERE bucket_start < now() - make_interval(days => ${retention.dataAccessRetentionDays})
    `),
  };
}
