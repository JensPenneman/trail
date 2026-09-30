import { readFileSync } from "node:fs";

export interface OverlandFeature {
  type: string;
  geometry?: { type: string; coordinates: number[] };
  properties: Record<string, unknown>;
}

/** An Overland upload body: records, the phone's current position and a trip in progress. */
export interface OverlandBatch {
  locations: OverlandFeature[];
  current?: OverlandFeature;
  trip?: Record<string, unknown>;
}

/** The API's realistic batch: 30 points of a bike ride, a visit, a trip and two app events. */
const fixture = new URL("../../../apps/api/tests/fixtures/overland-batch.json", import.meta.url);

const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** Around a daylight saving change the day starts an hour off; this margin absorbs that. */
const dayStartMarginMs = 90 * 60_000;

/** Midnight of today in `timeZone`, give or take the hour a DST change moves it. */
function startOfToday(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return now - ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000;
}

function instants(value: unknown): number[] {
  if (typeof value === "string") return timestamp.test(value) ? [Date.parse(value)] : [];
  if (Array.isArray(value)) return value.flatMap(instants);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(instants);
  return [];
}

function shifted(value: unknown, deltaMs: number): unknown {
  if (typeof value === "string" && timestamp.test(value)) {
    // Overland's own format: whole seconds, UTC.
    return new Date(Date.parse(value) + deltaMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (Array.isArray(value)) return value.map((item) => shifted(item, deltaMs));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shifted(item, deltaMs)]),
    );
  }
  return value;
}

/**
 * The fixture moved to today in `timeZone` (the account's), so Live, "points
 * today" and History's today show all of it: it ends 90 seconds ago, or — when
 * today is not yet long enough for its 14 hours (visit and trip included) —
 * starts shortly after midnight and reaches a few hours ahead, which the API
 * accepts (up to 24 h).
 */
export function overlandBatch(timeZone: string, now = Date.now()): OverlandBatch {
  const recorded: unknown = JSON.parse(readFileSync(fixture, "utf8"));
  const times = instants(recorded);
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  const dayStart = startOfToday(now, timeZone) + dayStartMarginMs;
  const endingNow = now - 90_000 - latest;
  const delta = earliest + endingNow >= dayStart ? endingNow : dayStart - earliest;
  return shifted(recorded, delta) as OverlandBatch;
}
