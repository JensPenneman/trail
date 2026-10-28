import { type SQL, sql } from "drizzle-orm";

/**
 * Whether the segment row `alias` overlaps `[from, to)`: the timeline's and
 * the level tracks' rule for which stops and moves a range holds, and the day
 * stamps' (`loadStampedDays`), so a day's processed stamp covers exactly the
 * segments its answers show — those across midnight on both days. `alias` is a
 * table alias of the caller's, never input.
 */
export function segmentOverlaps(alias: string, from: SQL, to: SQL): SQL {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`(${column("started_at")} < ${to} AND ${column("ended_at")} > ${from})`;
}
