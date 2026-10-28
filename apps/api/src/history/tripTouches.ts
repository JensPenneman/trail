import { type SQL, sql } from "drizzle-orm";
import { spannedLocalDays } from "../lib/spannedLocalDays";

/**
 * Whether the trip row `alias` overlaps `[from, to)` — one ending at `from`
 * included. The one rule for which trips a range holds: the finder's
 * (`findTrips`) and the day stamps' (`loadStampedDays`). `alias` is a table
 * alias of the caller's, never input.
 */
export function tripTouches(alias: string, from: SQL, to: SQL): SQL {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`(${column("started_at")} < ${to} AND ${column("ended_at")} >= ${from})`;
}

/**
 * The local days a trip touches under `tripTouches`, to tell open pages which
 * days changed: from the day it started to the day it ended
 * (`spannedLocalDays`: the two ends only for a trip of more than a month).
 */
export function tripDays(trip: { startedAt: Date; endedAt: Date }, timezone: string): string[] {
  return spannedLocalDays(trip.startedAt, trip.endedAt, timezone);
}
