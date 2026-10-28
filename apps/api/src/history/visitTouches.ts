import { type SQL, sql } from "drizzle-orm";
import { addDays, daysBetween } from "../lib/calendarDate";
import { localDate } from "../lib/localDate";

/**
 * Whether the visit row `alias` touches `[from, to)`: recorded, arrived or
 * departed inside it, or spanning it. The one rule for which visits a range
 * holds — the finder's (`findVisits`) and the day stamps' (`loadStampedDays`),
 * so a day's stamp counts exactly the visits its answers show. `alias` is a
 * table alias of the caller's, never input.
 */
export function visitTouches(alias: string, from: SQL, to: SQL): SQL {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`(
    (${column("recorded_at")} >= ${from} AND ${column("recorded_at")} < ${to})
    OR (${column("arrived_at")} >= ${from} AND ${column("arrived_at")} < ${to})
    OR (${column("departed_at")} >= ${from} AND ${column("departed_at")} < ${to})
    OR (${column("arrived_at")} < ${from} AND ${column("departed_at")} >= ${to})
  )`;
}

/** Days between two ends are named only this far apart: the stamps stay right either way. */
const spannedDaysLimit = 31;

/**
 * The local days a visit touches under `visitTouches`, to tell open pages
 * which days changed: those it was recorded, arrived and departed on, and
 * with both ends known the days between them, which it spans — up to a month
 * of them (a visit can claim decades; the stamps, read from the table, are
 * right whatever is named here).
 */
export function visitDays(
  visit: { recordedAt: Date; arrivedAt: Date | null; departedAt: Date | null },
  timezone: string,
): string[] {
  const days = new Set([localDate(visit.recordedAt, timezone)]);
  const arrived = visit.arrivedAt === null ? null : localDate(visit.arrivedAt, timezone);
  const departed = visit.departedAt === null ? null : localDate(visit.departedAt, timezone);
  if (arrived !== null) days.add(arrived);
  if (departed !== null) days.add(departed);
  if (arrived !== null && departed !== null && daysBetween(arrived, departed) <= spannedDaysLimit) {
    for (let day = addDays(arrived, 1); day < departed; day = addDays(day, 1)) days.add(day);
  }
  return [...days].sort();
}
