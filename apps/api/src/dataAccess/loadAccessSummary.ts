import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { localDate } from "../lib/localDate";
import { safeText } from "../mcp/safeText";

/** The lists of the summary are this long at most. */
const topLength = 20;

/** `YYYY-MM-DD` plus `days` calendar days. */
function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

type Counts<K extends string> = Record<K, number>;

const actorKinds = (): Counts<"owner" | "person" | "link" | "token"> => ({
  owner: 0,
  person: 0,
  link: 0,
  token: 0,
});

const channels = (): Counts<"web" | "api" | "mcp" | "people" | "live" | "link"> => ({
  web: 0,
  api: 0,
  mcp: 0,
  people: 0,
  live: 0,
  link: 0,
});

const add = <K extends string>(counts: Counts<K>, key: string, value: number): void => {
  if (key in counts) counts[key as K] += value;
};

interface ActionRow extends Record<string, unknown> {
  actor: string;
  action: string;
  events: number;
}

/** The actions of each actor, most often first. */
function actionsBy(rows: readonly ActionRow[]): Map<string, { action: string; count: number }[]> {
  const byActor = new Map<string, { action: string; count: number }[]>();
  for (const row of rows) {
    const list = byActor.get(row.actor) ?? [];
    list.push({ action: row.action, count: row.events });
    byActor.set(row.actor, list);
  }
  for (const list of byActor.values()) {
    list.sort((a, b) => b.count - a.count || (a.action < b.action ? -1 : 1));
  }
  return byActor;
}

/**
 * Who looked at the owner's data over the last `days` local days, today
 * included (docs/architecture.md §8.7): totals per kind of actor, channel and
 * kind of access, a dense series per local day of the owner's time zone (an
 * hour counts on the day it starts in), the people, links (with their
 * distinct visitors) and tokens with how often and when last, and the owner's
 * own sessions apart from everyone else. Only ever the owner's rows.
 */
export async function loadAccessSummary(
  db: Executor,
  owner: { id: string; timezone: string },
  days: number,
  now = new Date(),
): Promise<DataAccessSummary> {
  const timeZone = owner.timezone;
  const today = localDate(now, timeZone);
  const firstDay = addDays(today, -(days - 1));
  const [start] = (
    await db.execute<{ from: string }>(
      sql`SELECT (${firstDay}::date::timestamp AT TIME ZONE ${timeZone}) AS "from"`,
    )
  ).rows;
  const from = new Date(toIso(start?.from ?? now));
  // An hour counts on the local day it starts in, for the totals as for the series: in a zone
  // with half hours the hour around the first midnight belongs to the day before. The first
  // condition only narrows the index range.
  const period: SQL = sql`e.owner_user_id = ${owner.id}
    AND e.bucket_start >= ${from.toISOString()}::timestamptz - interval '1 hour'
    AND e.bucket_start < ${now.toISOString()}::timestamptz
    AND (e.bucket_start AT TIME ZONE ${timeZone})::date >= ${firstDay}::date`;

  const totals = await db.execute<{
    actor_kind: string;
    channel: string;
    access: string;
    events: number;
  }>(sql`
    SELECT e.actor_kind, e.channel, e.access, sum(e.count)::int AS events
    FROM data_access_events e WHERE ${period}
    GROUP BY e.actor_kind, e.channel, e.access
  `);
  const series = await db.execute<{ day: string; actor_kind: string; events: number }>(sql`
    SELECT to_char(e.bucket_start AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day, e.actor_kind,
      sum(e.count)::int AS events
    FROM data_access_events e WHERE ${period}
    GROUP BY 1, 2
  `);
  // A person's current name only while one of the owner's shares with them is in force.
  const people = await db.execute<{
    actor: string;
    name: string | null;
    events: number;
    last_at: string;
  }>(sql`
    SELECT e.actor_user_id AS actor,
      coalesce(u.display_name, (array_agg(e.actor_label ORDER BY e.last_at DESC))[1]) AS name,
      sum(e.count)::int AS events, max(e.last_at) AS last_at
    FROM data_access_events e
    LEFT JOIN users u ON u.id = e.actor_user_id AND EXISTS (
      SELECT 1 FROM shares sh
      WHERE sh.owner_user_id = ${owner.id} AND sh.recipient_user_id = u.id
        AND sh.revoked_at IS NULL AND (sh.expires_at IS NULL OR sh.expires_at > now())
    )
    WHERE ${period} AND e.actor_kind = 'person'
    GROUP BY e.actor_user_id, u.display_name
    ORDER BY events DESC, last_at DESC, actor
    LIMIT ${topLength}
  `);
  const links = await db.execute<{
    actor: string;
    label: string | null;
    events: number;
    visitors: number;
    last_at: string;
  }>(sql`
    SELECT e.actor_link_id AS actor,
      coalesce(l.label, (array_agg(e.actor_label ORDER BY e.last_at DESC))[1]) AS label,
      sum(e.count)::int AS events, count(DISTINCT e.visitor_key)::int AS visitors,
      max(e.last_at) AS last_at
    FROM data_access_events e
    LEFT JOIN share_links l ON l.id = e.actor_link_id AND l.owner_user_id = e.owner_user_id
    WHERE ${period} AND e.actor_kind = 'link'
    GROUP BY e.actor_link_id, l.label
    ORDER BY events DESC, last_at DESC, actor
    LIMIT ${topLength}
  `);
  const tokens = await db.execute<{
    actor: string;
    name: string | null;
    events: number;
    api: number;
    mcp: number;
    last_at: string;
  }>(sql`
    SELECT e.actor_token_id AS actor,
      coalesce(t.name, (array_agg(e.actor_label ORDER BY e.last_at DESC))[1]) AS name,
      sum(e.count)::int AS events,
      coalesce(sum(e.count) FILTER (WHERE e.channel = 'api'), 0)::int AS api,
      coalesce(sum(e.count) FILTER (WHERE e.channel = 'mcp'), 0)::int AS mcp,
      max(e.last_at) AS last_at
    FROM data_access_events e
    LEFT JOIN api_tokens t ON t.id = e.actor_token_id AND t.user_id = e.owner_user_id
    WHERE ${period} AND e.actor_kind = 'token'
    GROUP BY e.actor_token_id, t.name
    ORDER BY events DESC, last_at DESC, actor
    LIMIT ${topLength}
  `);
  const actorIds = (rows: readonly { actor: string }[]) => sql.param(rows.map((row) => row.actor));
  const personActions = await db.execute<ActionRow>(sql`
    SELECT e.actor_user_id::text AS actor, e.action, sum(e.count)::int AS events
    FROM data_access_events e
    WHERE ${period} AND e.actor_kind = 'person'
      AND e.actor_user_id = ANY(${actorIds(people.rows)}::uuid[])
    GROUP BY 1, 2
  `);
  const tokenActions = await db.execute<ActionRow>(sql`
    SELECT e.actor_token_id::text AS actor, e.action, sum(e.count)::int AS events
    FROM data_access_events e
    WHERE ${period} AND e.actor_kind = 'token'
      AND e.actor_token_id = ANY(${actorIds(tokens.rows)}::uuid[])
    GROUP BY 1, 2
  `);
  const sessions = await db.execute<{ label: string | null; events: number; last_at: string }>(sql`
    SELECT e.actor_label AS label, sum(e.count)::int AS events, max(e.last_at) AS last_at
    FROM data_access_events e
    WHERE ${period} AND e.actor_kind = 'owner'
    GROUP BY e.actor_label
    ORDER BY events DESC, last_at DESC, label
    LIMIT ${topLength}
  `);
  const own = await db.execute<{ events: number; last_at: string | null }>(sql`
    SELECT coalesce(sum(e.count), 0)::int AS events, max(e.last_at) AS last_at
    FROM data_access_events e
    WHERE ${period} AND e.actor_kind = 'owner'
  `);

  const total = {
    events: 0,
    byActorKind: actorKinds(),
    byChannel: channels(),
    reads: 0,
    writes: 0,
    exports: 0,
  };
  for (const row of totals.rows) {
    total.events += row.events;
    add(total.byActorKind, row.actor_kind, row.events);
    add(total.byChannel, row.channel, row.events);
    if (row.access === "read") total.reads += row.events;
    else if (row.access === "write") total.writes += row.events;
    else total.exports += row.events;
  }
  const perDay = new Map<string, { events: number; byActorKind: ReturnType<typeof actorKinds> }>();
  for (let day = firstDay; day <= today; day = addDays(day, 1)) {
    perDay.set(day, { events: 0, byActorKind: actorKinds() });
  }
  for (const row of series.rows) {
    const entry = perDay.get(row.day);
    if (entry === undefined) continue;
    entry.events += row.events;
    add(entry.byActorKind, row.actor_kind, row.events);
  }
  const ofPeople = actionsBy(personActions.rows);
  const ofTokens = actionsBy(tokenActions.rows);
  const [mine] = own.rows;

  return {
    timezone: timeZone,
    days,
    from: from.toISOString(),
    to: now.toISOString(),
    totals: total,
    series: [...perDay].map(([date, entry]) => ({ date, ...entry })),
    people: people.rows.map((row) => ({
      userId: row.actor,
      displayName: safeText(row.name ?? "", 80),
      events: row.events,
      lastAt: toIso(row.last_at),
      actions: ofPeople.get(row.actor) ?? [],
    })),
    links: links.rows.map((row) => ({
      linkId: row.actor,
      label: safeText(row.label ?? "", 80),
      events: row.events,
      visitors: row.visitors,
      lastAt: toIso(row.last_at),
    })),
    tokens: tokens.rows.map((row) => ({
      tokenId: row.actor,
      name: safeText(row.name ?? "", 80),
      events: row.events,
      api: row.api,
      mcp: row.mcp,
      lastAt: toIso(row.last_at),
      actions: ofTokens.get(row.actor) ?? [],
    })),
    own: {
      events: mine?.events ?? 0,
      lastAt: mine?.last_at === null || mine?.last_at === undefined ? null : toIso(mine.last_at),
      sessions: sessions.rows.map((row) => ({
        label: row.label ?? "",
        events: row.events,
        lastAt: toIso(row.last_at),
      })),
    },
  };
}
