import { type SQL, sql } from "drizzle-orm";
import { localDate } from "../lib/localDate";
import { spannedLocalDays } from "../lib/spannedLocalDays";

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

/**
 * The local days a visit touches under `visitTouches`, to tell open pages
 * which days changed: those it was recorded, arrived and departed on, and
 * with both ends known the days between them, which it spans
 * (`spannedLocalDays`: up to a month of them).
 */
export function visitDays(
  visit: { recordedAt: Date; arrivedAt: Date | null; departedAt: Date | null },
  timezone: string,
): string[] {
  const days = new Set([localDate(visit.recordedAt, timezone)]);
  const { arrivedAt, departedAt } = visit;
  if (arrivedAt !== null) days.add(localDate(arrivedAt, timezone));
  if (departedAt !== null) days.add(localDate(departedAt, timezone));
  if (arrivedAt !== null && departedAt !== null) {
    for (const day of spannedLocalDays(arrivedAt, departedAt, timezone)) days.add(day);
  }
  return [...days].sort();
}
