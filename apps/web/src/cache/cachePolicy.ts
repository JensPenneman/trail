import type { DayStamp } from "@trail/contracts/cacheStamp";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/**
 * How a revalidation asks: with the answer's ETag (`If-None-Match`, a `304`
 * when nothing changed), first with the stamps of a past day against the
 * calendar's digest (no request at all while they match), or not at all
 * conditionally.
 */
type Validation = "etag" | "stamps" | "none";

/**
 * Which entries are restored before the first paint: always, while the period
 * they cover includes now (today, the current month), only the device that
 * reported last, or never — those come as their page asks.
 */
type WarmRule = "always" | "current" | "latest-device" | "never";

/**
 * How an answer is stored (cacheCodecs.ts): packed points of tracks and level
 * tracks, packed heat cells, or as answered — and checked with which schema.
 */
export type CodecName =
  | "config"
  | "devices"
  | "tracks"
  | "level-tracks"
  | "timeline"
  | "visits"
  | "trips"
  | "days"
  | "heatmap"
  | "insights"
  | "device-mode"
  | "activity"
  | "ingest-log";

export interface ResourcePolicy {
  warm: WarmRule;
  /** How long an answer is shown without asking (TanStack's `staleTime`). */
  freshMs: number;
  /** How long an entry may stay untouched before the sweep removes it. */
  ttlMs: number;
  /** An answer about today lives until the day ends and this long after. */
  todayTtlMs: number | null;
  validate: Validation;
  /** Which stamps a past day's answer depends on: the recorded data, or that and its processing. */
  stamps: "raw" | "both" | null;
  /** At most this many entries, the most recently touched. */
  maxEntries: number | null;
  /** Answers about local days: an entry of another time zone is dropped. */
  zoned: boolean;
  /** Holds a device's data: removing the device removes the entries that cover it. */
  deviceData: boolean;
  /** Which of the answers' periods the store keeps first when it runs out of room. */
  eviction: "settled" | "insights" | "other";
  codec: CodecName;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The parts of a day-sliced answer's policy they all share. */
const daySliced = {
  freshMs: 30_000,
  ttlMs: 90 * day,
  todayTtlMs: 7 * day,
  validate: "stamps",
  maxEntries: null,
  zoned: true,
  deviceData: true,
  eviction: "settled",
} as const;

/**
 * What the browser keeps of the signed-in person's own answers, and for how
 * long (docs/architecture.md §14) — the table of the cache, as data. A query
 * whose key starts with anything else is memory only: other people's data,
 * the access log, sessions, passkeys, tokens and every list of Settings never
 * reach the disk, and a new query stays in memory until it is added here on
 * purpose.
 */
export const cachePolicy: Readonly<Record<string, ResourcePolicy>> = {
  config: {
    warm: "always",
    freshMs: hour,
    ttlMs: 30 * day,
    todayTtlMs: null,
    validate: "none",
    stamps: null,
    maxEntries: 1,
    zoned: false,
    deviceData: false,
    eviction: "other",
    codec: "config",
  },
  devices: {
    warm: "always",
    freshMs: 30_000,
    ttlMs: 30 * day,
    todayTtlMs: null,
    validate: "etag",
    stamps: null,
    maxEntries: 1,
    zoned: false,
    deviceData: true,
    eviction: "other",
    codec: "devices",
  },
  tracks: { ...daySliced, warm: "current", stamps: "raw", codec: "tracks" },
  // Raw tracks at a level depend on the recorded data only; the other levels on its processing too.
  "level-tracks": { ...daySliced, warm: "current", stamps: "both", codec: "level-tracks" },
  timeline: { ...daySliced, warm: "current", stamps: "both", codec: "timeline" },
  visits: { ...daySliced, warm: "never", stamps: "raw", codec: "visits" },
  trips: { ...daySliced, warm: "never", stamps: "raw", codec: "trips" },
  days: {
    ...daySliced,
    warm: "current",
    freshMs: minute,
    todayTtlMs: null,
    validate: "etag",
    stamps: null,
    codec: "days",
  },
  heatmap: {
    warm: "never",
    freshMs: 5 * minute,
    ttlMs: 30 * day,
    todayTtlMs: null,
    validate: "etag",
    stamps: null,
    maxEntries: 20,
    zoned: false,
    deviceData: true,
    eviction: "other",
    codec: "heatmap",
  },
  insights: {
    warm: "never",
    freshMs: 5 * minute,
    ttlMs: 30 * day,
    todayTtlMs: null,
    validate: "etag",
    stamps: null,
    maxEntries: null,
    zoned: true,
    deviceData: true,
    eviction: "insights",
    codec: "insights",
  },
  "device-mode": {
    warm: "latest-device",
    freshMs: 30_000,
    ttlMs: day,
    todayTtlMs: null,
    validate: "none",
    stamps: null,
    maxEntries: null,
    zoned: false,
    deviceData: true,
    eviction: "other",
    codec: "device-mode",
  },
  activity: {
    warm: "never",
    freshMs: 5 * minute,
    ttlMs: 7 * day,
    todayTtlMs: null,
    validate: "none",
    stamps: null,
    maxEntries: null,
    zoned: false,
    deviceData: true,
    eviction: "other",
    codec: "activity",
  },
  "ingest-log": {
    warm: "never",
    freshMs: 30_000,
    ttlMs: 7 * day,
    todayTtlMs: null,
    validate: "none",
    stamps: null,
    maxEntries: null,
    zoned: false,
    deviceData: true,
    eviction: "other",
    codec: "ingest-log",
  },
};

/** The policy of a query key, or null when its answers stay in memory. */
export function policyOf(queryKey: readonly unknown[]): ResourcePolicy | null {
  const resource = queryKey[0];
  if (typeof resource !== "string" || !Object.hasOwn(cachePolicy, resource)) return null;
  return cachePolicy[resource] ?? null;
}

/** How long an answer of `resource` is shown without asking. */
export function freshFor(resource: string): number {
  return cachePolicy[resource]?.freshMs ?? 30_000;
}

/** Which stamps decide whether an answer to this key is current; level tracks at `raw` need the raw one only. */
export function stampsCompared(queryKey: readonly unknown[]): "raw" | "both" | null {
  const policy = policyOf(queryKey);
  if (policy === null || policy.stamps === null) return null;
  const params = queryKey[1];
  if (queryKey[0] === "level-tracks" && isRecord(params) && params["level"] === "raw") return "raw";
  return policy.stamps;
}

/** The stamps of the days an answer covers, as day-sliced answers carry them (`stamps`). */
export function stampsOf(answer: unknown): readonly DayStamp[] | undefined {
  if (!isRecord(answer)) return undefined;
  const stamps = answer["stamps"];
  return Array.isArray(stamps) ? (stamps as DayStamp[]) : undefined;
}

/** No entry is ever written above this: no contract allows an answer of that size. */
export const maxEntryBytes = 4 * 1024 * 1024;
/** Past this the sweep removes what is least needed; past the hard budget nothing is written. */
export const softBudgetBytes = 32 * 1024 * 1024;
export const hardBudgetBytes = 64 * 1024 * 1024;
