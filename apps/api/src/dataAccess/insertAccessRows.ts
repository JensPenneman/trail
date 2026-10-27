import type { DataAccessResource } from "@trail/contracts/dataAccess";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

/** One row of `data_access_events`, ready to be written. */
export interface AccessRow {
  ownerUserId: string;
  bucketStart: Date;
  firstAt: Date;
  lastAt: Date;
  count: number;
  actorKind: string;
  channel: string;
  actorUserId: string | null;
  actorSessionId: string | null;
  actorTokenId: string | null;
  actorShareId: string | null;
  actorLinkId: string | null;
  actorLabel: string | null;
  visitorKey: string | null;
  ipCoarse: string | null;
  uaFamily: string | null;
  action: string;
  access: string;
  resource: DataAccessResource;
  status: number;
  dedupeKey: string;
}

/**
 * Writes the rows in one statement: an upsert that adds the counts to the
 * rows the hours already have and widens their first and last times
 * (docs/architecture.md §8.7). The rows travel as one array per column. Rows
 * of an account deleted meanwhile are left out instead of failing the rest:
 * the log goes with the account.
 */
export async function insertAccessRows(db: Executor, rows: readonly AccessRow[]): Promise<void> {
  if (rows.length === 0) return;
  const column = <T>(pick: (row: AccessRow) => T) => sql.param(rows.map(pick));
  await db.execute(sql`
    INSERT INTO data_access_events (owner_user_id, bucket_start, first_at, last_at, count,
      actor_kind, channel, actor_user_id, actor_session_id, actor_token_id, actor_share_id,
      actor_link_id, actor_label, visitor_key, ip_coarse, ua_family, action, access, resource,
      status, dedupe_key)
    SELECT v.owner_user_id, v.bucket_start, v.first_at, v.last_at, v.count, v.actor_kind,
      v.channel, v.actor_user_id, v.actor_session_id, v.actor_token_id, v.actor_share_id,
      v.actor_link_id, v.actor_label, v.visitor_key, v.ip_coarse, v.ua_family, v.action,
      v.access, v.resource, v.status, v.dedupe_key
    FROM unnest(
      ${column((row) => row.ownerUserId)}::uuid[],
      ${column((row) => row.bucketStart.toISOString())}::timestamptz[],
      ${column((row) => row.firstAt.toISOString())}::timestamptz[],
      ${column((row) => row.lastAt.toISOString())}::timestamptz[],
      ${column((row) => row.count)}::int[],
      ${column((row) => row.actorKind)}::text[],
      ${column((row) => row.channel)}::text[],
      ${column((row) => row.actorUserId)}::uuid[],
      ${column((row) => row.actorSessionId)}::text[],
      ${column((row) => row.actorTokenId)}::uuid[],
      ${column((row) => row.actorShareId)}::uuid[],
      ${column((row) => row.actorLinkId)}::uuid[],
      ${column((row) => row.actorLabel)}::text[],
      ${column((row) => row.visitorKey)}::text[],
      ${column((row) => row.ipCoarse)}::text[],
      ${column((row) => row.uaFamily)}::text[],
      ${column((row) => row.action)}::text[],
      ${column((row) => row.access)}::text[],
      ${column((row) => JSON.stringify(row.resource))}::jsonb[],
      ${column((row) => row.status)}::smallint[],
      ${column((row) => row.dedupeKey)}::text[]
    ) AS v(owner_user_id, bucket_start, first_at, last_at, count, actor_kind, channel,
      actor_user_id, actor_session_id, actor_token_id, actor_share_id, actor_link_id,
      actor_label, visitor_key, ip_coarse, ua_family, action, access, resource, status,
      dedupe_key)
    WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v.owner_user_id)
    ON CONFLICT (owner_user_id, bucket_start, dedupe_key) DO UPDATE SET
      count = data_access_events.count + excluded.count,
      first_at = least(data_access_events.first_at, excluded.first_at),
      last_at = greatest(data_access_events.last_at, excluded.last_at),
      actor_label = excluded.actor_label,
      status = excluded.status
  `);
}
