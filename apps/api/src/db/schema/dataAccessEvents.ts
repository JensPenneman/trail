import {
  type DataAccessResource,
  dataAccessActorKinds,
  dataAccessChannels,
  dataAccessKinds,
} from "@trail/contracts/dataAccess";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "../columns/timestamptz";
import { users } from "./users";

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * The data access log (docs/architecture.md §8.8): one row per owner, UTC
 * hour and access — the same actor doing the same thing to the same data —
 * with how often it happened. Kept `DATA_ACCESS_RETENTION_DAYS` (365 by
 * default), removed with the owner's account. Actors are referenced without
 * foreign keys: sessions, tokens, shares, links and accounts end long before
 * the log does, and `actor_label` keeps the name they had. The checks hold the
 * privacy rules even against a bug: a network address only for link visitors
 * and only as a /24 or /48, and nothing of a recipient's own credentials.
 * The migration sets `fillfactor = 70`, which drizzle-kit cannot express:
 * the current hour's rows are counted again every few seconds, and the room
 * left on each page keeps those updates heap-only (no index churn, a table a
 * fifth of the size under load).
 */
export const dataAccessEvents = pgTable(
  "data_access_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** Whose data it was. */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The UTC hour the row counts. */
    bucketStart: timestamptz("bucket_start").notNull(),
    firstAt: timestamptz("first_at").notNull(),
    lastAt: timestamptz("last_at").notNull(),
    count: integer("count").notNull(),
    actorKind: text("actor_kind", { enum: dataAccessActorKinds }).notNull(),
    channel: text("channel", { enum: dataAccessChannels }).notNull(),
    /** A person who looked through a share. */
    actorUserId: uuid("actor_user_id"),
    /** The owner's own session (`sessions.id`). */
    actorSessionId: text("actor_session_id"),
    /** One of the owner's API tokens. */
    actorTokenId: uuid("actor_token_id"),
    /** The share a person looked through. */
    actorShareId: uuid("actor_share_id"),
    /** The public link a visitor opened. */
    actorLinkId: uuid("actor_link_id"),
    /** The actor's name when it happened: browser, token name, person's name or link label. */
    actorLabel: text("actor_label"),
    /** Link visitors only: an HMAC of `ip_coarse` and `ua_family` under a server key. */
    visitorKey: text("visitor_key"),
    /** Link visitors only: the network, IPv4 /24 or IPv6 /48, as text. */
    ipCoarse: text("ip_coarse"),
    /** Link visitors only: "iPhone · Safari". */
    uaFamily: text("ua_family"),
    action: text("action").notNull(),
    access: text("access", { enum: dataAccessKinds }).notNull(),
    resource: jsonb("resource").$type<DataAccessResource>().notNull(),
    status: smallint("status").notNull(),
    /** SHA-256 (base64url) of the actor, channel, action, kind and resource. */
    dedupeKey: text("dedupe_key").notNull(),
  },
  (table) => [
    // The upsert's key, and the owner's log by the hour: the list newest hour first, the
    // summary and the retention (PostgreSQL 18 skips through it owner by owner). Nothing
    // indexed changes when a row is counted again, so those updates stay heap-only.
    unique("data_access_events_owner_user_id_bucket_start_dedupe_key_key").on(
      table.ownerUserId,
      table.bucketStart,
      table.dedupeKey,
    ),
    // One actor's lines, for the token, link and share pages of the dashboard.
    index("data_access_events_actor_token_id_idx")
      .on(table.actorTokenId, table.bucketStart.desc())
      .where(sql`${table.actorTokenId} IS NOT NULL`),
    index("data_access_events_actor_link_id_idx")
      .on(table.actorLinkId, table.bucketStart.desc())
      .where(sql`${table.actorLinkId} IS NOT NULL`),
    index("data_access_events_actor_share_id_idx")
      .on(table.actorShareId, table.bucketStart.desc())
      .where(sql`${table.actorShareId} IS NOT NULL`),
    check(
      "data_access_events_bucket_check",
      sql`${table.bucketStart} = date_trunc('hour', ${table.bucketStart}, 'UTC') AND ${table.firstAt} <= ${table.lastAt}`,
    ),
    check("data_access_events_count_check", sql`${table.count} > 0`),
    check(
      "data_access_events_kinds_check",
      sql`${table.actorKind} IN (${listed(dataAccessActorKinds)}) AND ${table.channel} IN (${listed(dataAccessChannels)}) AND ${table.access} IN (${listed(dataAccessKinds)})`,
    ),
    // Each kind of actor with its own reference and channels, and nothing else.
    check(
      "data_access_events_actor_check",
      sql`CASE ${table.actorKind}
        WHEN 'owner' THEN ${table.channel} = 'web' AND ${table.actorSessionId} IS NOT NULL
          AND ${table.actorUserId} IS NULL AND ${table.actorTokenId} IS NULL
          AND ${table.actorShareId} IS NULL AND ${table.actorLinkId} IS NULL
        WHEN 'token' THEN ${table.channel} IN ('api', 'mcp') AND ${table.actorTokenId} IS NOT NULL
          AND ${table.actorUserId} IS NULL AND ${table.actorSessionId} IS NULL
          AND ${table.actorShareId} IS NULL AND ${table.actorLinkId} IS NULL
        WHEN 'person' THEN ${table.channel} IN ('people', 'live') AND ${table.actorUserId} IS NOT NULL
          AND ${table.actorSessionId} IS NULL AND ${table.actorTokenId} IS NULL
          AND ${table.actorLinkId} IS NULL
        WHEN 'link' THEN ${table.channel} = 'link' AND ${table.actorLinkId} IS NOT NULL
          AND ${table.actorUserId} IS NULL AND ${table.actorSessionId} IS NULL
          AND ${table.actorTokenId} IS NULL AND ${table.actorShareId} IS NULL
        ELSE false END`,
    ),
    // A network address is a link visitor's, and never more precise than a /24 or a /48.
    check(
      "data_access_events_visitor_check",
      sql`(${table.actorKind} = 'link' OR (${table.visitorKey} IS NULL AND ${table.ipCoarse} IS NULL AND ${table.uaFamily} IS NULL))
        AND (${table.ipCoarse} IS NULL OR masklen(${table.ipCoarse}::cidr) = CASE family(${table.ipCoarse}::cidr) WHEN 4 THEN 24 ELSE 48 END)
        AND (${table.visitorKey} IS NULL OR char_length(${table.visitorKey}) = 16)
        AND (${table.uaFamily} IS NULL OR char_length(${table.uaFamily}) <= 60)`,
    ),
    check(
      "data_access_events_text_check",
      sql`char_length(${table.action}) BETWEEN 1 AND 64 AND (${table.actorLabel} IS NULL OR char_length(${table.actorLabel}) <= 120)
        AND char_length(${table.dedupeKey}) = 43 AND jsonb_typeof(${table.resource}) = 'object'
        AND ${table.status} BETWEEN 100 AND 599`,
    ),
  ],
);
