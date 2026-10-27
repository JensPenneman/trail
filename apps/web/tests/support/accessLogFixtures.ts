import type {
  DataAccessEvent,
  DataAccessLogResponse,
  DataAccessSummary,
} from "@trail/contracts/dataAccess";
import { ids } from "./fixtures";

/*
 * Contract-shaped data of the data access log: a summary of the last days of
 * the Brussels test account, and lines of the log.
 */

const hour = 3_600_000;

/** `YYYY-MM-DD` of an instant in Brussels. */
const brusselsDate = (instant: number): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);

const actorKinds = () => ({ owner: 0, person: 0, link: 0, token: 0 });
const channels = () => ({ web: 0, api: 0, mcp: 0, people: 0, live: 0, link: 0 });

/** A summary of `days` days in which nobody did anything. */
export function emptySummary(days = 30, now = Date.now()): DataAccessSummary {
  const series = Array.from({ length: days }, (_, index) => ({
    date: brusselsDate(now - (days - 1 - index) * 24 * hour),
    events: 0,
    byActorKind: actorKinds(),
    byChannel: channels(),
  }));
  return {
    timezone: "Europe/Brussels",
    days,
    from: new Date(now - days * 24 * hour).toISOString(),
    to: new Date(now).toISOString(),
    totals: {
      events: 0,
      people: 0,
      visitors: 0,
      byActorKind: actorKinds(),
      byChannel: channels(),
      reads: 0,
      writes: 0,
      exports: 0,
    },
    series,
    people: [],
    links: [],
    tokens: [],
    own: { events: 0, lastAt: null, sessions: [] },
  };
}

/**
 * The last `days` days of the account: Ana looked 14 times at the position
 * and twice at the history and got 30 live updates, a link was opened 3 times
 * by 2 visitors, Home Assistant made 10 API and 4 MCP calls, and the owner's
 * own browser 120 reads — all of it today but Ana's history, yesterday.
 */
export function busySummary(days = 30, now = Date.now()): DataAccessSummary {
  const summary = emptySummary(days, now);
  const today = summary.series.at(-1);
  const yesterday = summary.series.at(-2);
  if (today === undefined || yesterday === undefined) throw new Error("A summary needs two days");
  Object.assign(today, {
    events: 14 + 30 + 3 + 14 + 120,
    byActorKind: { owner: 120, person: 44, link: 3, token: 14 },
    byChannel: { web: 120, api: 10, mcp: 4, people: 14, live: 30, link: 3 },
  });
  Object.assign(yesterday, {
    events: 2,
    byActorKind: { ...actorKinds(), person: 2 },
    byChannel: { ...channels(), people: 2 },
  });
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    ...summary,
    totals: {
      events: 185,
      people: 1,
      visitors: 2,
      byActorKind: { owner: 120, person: 46, link: 3, token: 14 },
      byChannel: { web: 120, api: 10, mcp: 4, people: 16, live: 30, link: 3 },
      reads: 183,
      writes: 2,
      exports: 0,
    },
    people: [
      {
        userId: ids.ana,
        displayName: "Ana Bell",
        events: 46,
        lastAt: iso(now - 10 * 60_000),
        actions: [
          { action: "live.position", count: 30 },
          { action: "listPeople", count: 12 },
          { action: "getPerson", count: 2 },
          { action: "getPersonTrack", count: 2 },
        ],
      },
    ],
    links: [
      {
        linkId: ids.link,
        label: "Jens on the way home",
        events: 3,
        visitors: 2,
        lastAt: iso(now - 20 * 60_000),
      },
    ],
    tokens: [
      {
        tokenId: ids.token,
        name: "Home Assistant",
        events: 14,
        api: 10,
        mcp: 4,
        lastAt: iso(now - 30 * 60_000),
        actions: [
          { action: "getTracks", count: 10 },
          { action: "mcp.get_timeline", count: 4 },
        ],
      },
    ],
    own: {
      events: 120,
      lastAt: iso(now - 60_000),
      sessions: [{ label: "Firefox on Mac", events: 120, lastAt: iso(now - 60_000) }],
    },
  };
}

let lines = 0;

/** A line of the log; `ago` is how long before now its hour started. */
export function accessLine(
  overrides: Partial<DataAccessEvent> = {},
  ago = 0,
  now = Date.now(),
): DataAccessEvent {
  lines += 1;
  const bucket = Math.floor((now - ago) / hour) * hour;
  return {
    id: `${bucket / hour}.${String(lines).padStart(43, "k")}`,
    bucketStart: new Date(bucket).toISOString(),
    firstAt: new Date(bucket + 3 * 60_000).toISOString(),
    lastAt: new Date(bucket + 41 * 60_000).toISOString(),
    count: 2,
    actorKind: "person",
    channel: "people",
    actor: { kind: "person", userId: ids.ana, displayName: "Ana Bell", shareId: ids.myShare },
    action: "getPersonTrack",
    access: "read",
    resource: {
      deviceIds: [ids.phone],
      from: "2026-10-20T00:00:00.000Z",
      to: "2026-10-27T00:00:00.000Z",
      precision: "precise",
    },
    status: 200,
    ...overrides,
  };
}

/** One page of lines. */
export const page = (
  items: DataAccessEvent[],
  nextCursor: string | null = null,
): DataAccessLogResponse => ({ items, nextCursor });
