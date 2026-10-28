import { type SQL, sql } from "drizzle-orm";
import { addDays, daysBetween } from "../lib/calendarDate";
import { localDate } from "../lib/localDate";

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

/** Days between the two ends are named only this far apart: the stamps stay right either way. */
const spannedDaysLimit = 31;

/**
 * The local days a trip touches under `tripTouches`, to tell open pages which
 * days changed: from the day it started to the day it ended — the two ends
 * only for a trip of more than a month (the stamps, read from the table, are
 * right whatever is named here).
 */
export function tripDays(trip: { startedAt: Date; endedAt: Date }, timezone: string): string[] {
  const first = localDate(trip.startedAt, timezone);
  const last = localDate(trip.endedAt, timezone);
  if (last < first) return [first];
  if (daysBetween(first, last) > spannedDaysLimit) return [first, last];
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}
