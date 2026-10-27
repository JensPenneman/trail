import type {
  DataAccessActor,
  DataAccessActorKind,
  DataAccessChannel,
  DataAccessEvent,
  DataAccessLogResponse,
} from "@trail/contracts/dataAccess";
import { type SQL, sql } from "drizzle-orm";
import { userAgentLabel } from "../auth/userAgentLabel";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { safeText } from "../mcp/safeText";
import { accessLineId, decodeAccessLogCursor, encodeAccessLogCursor } from "./accessLogCursor";

export interface AccessLogFilter {
  from?: string | undefined;
  to?: string | undefined;
  actor?: readonly DataAccessActorKind[] | undefined;
  channel?: readonly DataAccessChannel[] | undefined;
  action?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

interface LogRow extends Record<string, unknown> {
  bucket_start: string;
  dedupe_key: string;
  first_at: string;
  last_at: string;
  count: number;
  actor_kind: string;
  channel: string;
  actor_user_id: string | null;
  actor_share_id: string | null;
  actor_token_id: string | null;
  actor_link_id: string | null;
  actor_label: string | null;
  visitor_key: string | null;
  ip_coarse: string | null;
  ua_family: string | null;
  action: string;
  access: string;
  resource: Record<string, unknown>;
  status: number;
  person_name: string | null;
  token_name: string | null;
  link_label: string | null;
  session_agent: string | null;
  session_found: boolean;
}

/** Names people typed, cleaned like the ones the log keeps (`DataAccessRecorder`). */
const clean = (name: string | null, fallback: string): string =>
  name === null ? fallback : safeText(name, 80);

/**
 * Who the row's actor is, with the name they have now while they still
 * exist — a renamed token, a link's label — and the name they had at the
 * time otherwise (a revoked token pruned, a session that ended). A person's
 * current name only while the share they looked through is in force: once
 * it has ended, the owner learns nothing new of them, not even a new name.
 */
function actorOf(row: LogRow): DataAccessActor {
  const label = row.actor_label ?? "";
  switch (row.actor_kind) {
    case "token":
      return {
        kind: "token",
        tokenId: row.actor_token_id ?? "",
        tokenName: clean(row.token_name, label),
      };
    case "person":
      return {
        kind: "person",
        userId: row.actor_user_id ?? "",
        displayName: clean(row.person_name, label),
        shareId: row.actor_share_id,
      };
    case "link":
      return {
        kind: "link",
        linkId: row.actor_link_id ?? "",
        linkLabel: clean(row.link_label, label),
        visitor:
          row.visitor_key === null
            ? null
            : { key: row.visitor_key, ipCoarse: row.ip_coarse, uaFamily: row.ua_family ?? "" },
      };
    default:
      return {
        kind: "owner",
        sessionLabel: row.session_found ? userAgentLabel(row.session_agent) : label,
      };
  }
}

const inList = (column: SQL, values: readonly string[] | undefined): SQL =>
  values === undefined ? sql`` : sql`AND ${column} = ANY(${sql.param([...values])}::text[])`;

/**
 * One page of the owner's data access log (docs/architecture.md §8.8),
 * newest hour first: only ever the owner's rows — nobody else's account, no
 * administrator — filtered by period, kinds of actor, channels and action.
 * The keyset is the table's unique key — the hour and the dedupe key —
 * which never changes once a row exists, so a row counted again while
 * someone pages never moves between pages; ids and cursors are made of it,
 * never of the identity column, which counts the rows of every account.
 */
export async function loadAccessLog(
  db: Executor,
  ownerUserId: string,
  filter: AccessLogFilter,
): Promise<DataAccessLogResponse> {
  const after = filter.cursor === undefined ? null : decodeAccessLogCursor(filter.cursor);
  const instant = (value: string) => sql`${new Date(value).toISOString()}::timestamptz`;
  const afterBucket = after === null ? null : instant(after.bucketStart.toISOString());
  const afterKey = after?.dedupeKey ?? null;
  const conditions = [
    // `from` takes in the hour it falls in.
    filter.from === undefined
      ? sql``
      : sql`AND e.bucket_start > ${instant(filter.from)} - interval '1 hour'`,
    filter.to === undefined ? sql`` : sql`AND e.bucket_start < ${instant(filter.to)}`,
    inList(sql`e.actor_kind`, filter.actor),
    inList(sql`e.channel`, filter.channel),
    filter.action === undefined ? sql`` : sql`AND e.action = ${filter.action}`,
    after === null
      ? sql``
      : sql`AND (e.bucket_start, e.dedupe_key) < (${afterBucket}, ${afterKey})`,
  ];
  const { rows } = await db.execute<LogRow>(sql`
    SELECT e.bucket_start, e.dedupe_key, e.first_at, e.last_at, e.count, e.actor_kind,
      e.channel, e.actor_user_id, e.actor_share_id, e.actor_token_id, e.actor_link_id,
      e.actor_label, e.visitor_key, e.ip_coarse, e.ua_family, e.action, e.access, e.resource,
      e.status, u.display_name AS person_name, t.name AS token_name, l.label AS link_label,
      s.user_agent AS session_agent, s.id IS NOT NULL AS session_found
    FROM data_access_events e
    LEFT JOIN shares sh ON e.actor_kind = 'person' AND sh.id = e.actor_share_id
      AND sh.owner_user_id = e.owner_user_id AND sh.recipient_user_id = e.actor_user_id
      AND sh.revoked_at IS NULL AND (sh.expires_at IS NULL OR sh.expires_at > now())
    LEFT JOIN users u ON sh.id IS NOT NULL AND u.id = e.actor_user_id
    LEFT JOIN api_tokens t ON e.actor_kind = 'token' AND t.id = e.actor_token_id
      AND t.user_id = e.owner_user_id
    LEFT JOIN share_links l ON e.actor_kind = 'link' AND l.id = e.actor_link_id
      AND l.owner_user_id = e.owner_user_id
    LEFT JOIN sessions s ON e.actor_kind = 'owner' AND s.id = e.actor_session_id
      AND s.user_id = e.owner_user_id
    WHERE e.owner_user_id = ${ownerUserId} ${sql.join(conditions, sql` `)}
    ORDER BY e.bucket_start DESC, e.dedupe_key DESC
    LIMIT ${filter.limit + 1}
  `);
  const page = rows.slice(0, filter.limit);
  const items = page.map(
    (row): DataAccessEvent => ({
      id: accessLineId(new Date(toIso(row.bucket_start)), row.dedupe_key),
      bucketStart: toIso(row.bucket_start),
      firstAt: toIso(row.first_at),
      lastAt: toIso(row.last_at),
      count: row.count,
      actorKind: row.actor_kind as DataAccessActorKind,
      channel: row.channel as DataAccessChannel,
      actor: actorOf(row),
      action: row.action,
      access: row.access as DataAccessEvent["access"],
      resource: row.resource,
      status: row.status,
    }),
  );
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > filter.limit && last !== undefined
        ? encodeAccessLogCursor({
            bucketStart: new Date(toIso(last.bucket_start)),
            dedupeKey: last.dedupe_key,
          })
        : null,
  };
}
