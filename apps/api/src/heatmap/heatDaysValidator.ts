import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { heatGeneration } from "./heatGeneration";

/**
 * A kept processed point in the local day of the daily statistics row `row`, a range of the
 * primary key. A day of nothing but dropped points (fixes too inaccurate to keep) has no cells to
 * make, so it is not "missing" either.
 */
export const keptPointInDay = (row: SQL, timezone: SQL): SQL => sql`EXISTS (
  SELECT 1 FROM processed_points p
  WHERE p.device_id = ${row}.device_id AND p.kept
    AND p.recorded_at >= (${row}.date::timestamp AT TIME ZONE ${timezone})
    AND p.recorded_at < ((${row}.date + 1)::timestamp AT TIME ZONE ${timezone})
)`;

interface Row extends Record<string, unknown> {
  rows: number;
  computed: string | null;
  points: string | null;
}

/**
 * How many (device, day) pairs of the period are marked for a rebuild that has not run yet: a pass
 * has changed their points or segments, and their cells (some seconds behind it) are not made
 * again. The answer is `pending` while there are any, and its tag moves with them.
 */
export async function heatDaysMarked(
  db: Executor,
  deviceIds: readonly string[],
  period: { from: string; to: string },
): Promise<number> {
  if (deviceIds.length === 0) return 0;
  const result = await db.execute<{ marked: number }>(sql`
    SELECT count(*)::int AS marked FROM heat_day_marks
    WHERE device_id = ANY(${sql.param(deviceIds)}::uuid[])
      AND day BETWEEN ${period.from}::date AND ${period.to}::date
  `);
  return result.rows[0]?.marked ?? 0;
}

/**
 * What an answer made of `heat_days` is made of, read before the cells (docs/architecture.md
 * §8.9): the rows of the period's days at the coarsest level — their count, newest `computed_at`
 * and points, which a pass, a mode correction, a deletion and a rebuild in a new time zone all
 * move — and the generation of rebuilds. The rest of the answer's input (zone, period, devices,
 * measure, mode, `pending`) is `insightsValidator`'s and the router's.
 */
export async function heatDaysValidator(
  db: Executor,
  deviceIds: readonly string[],
  period: { from: string; to: string },
): Promise<unknown> {
  if (deviceIds.length === 0) return [heatGeneration(), null];
  const marked = await heatDaysMarked(db, deviceIds, period);
  const result = await db.execute<Row>(sql`
    SELECT count(*)::int AS rows, max(computed_at)::text AS computed, sum(points)::text AS points
    FROM heat_days
    WHERE device_id = ANY(${sql.param(deviceIds)}::uuid[]) AND z = 12
      AND day BETWEEN ${period.from}::date AND ${period.to}::date
  `);
  const row = result.rows[0];
  return [heatGeneration(), row?.rows ?? 0, row?.computed ?? null, row?.points ?? null, marked];
}

/**
 * Whether a day of the period has points (the daily statistics say) but no cells yet: history the
 * features backfill (`featureBackfill.ts`) has not reached. The answer is `pending` while it
 * has not.
 */
export async function heatDaysMissing(
  db: Executor,
  deviceIds: readonly string[],
  period: { from: string; to: string },
  timezone: string,
): Promise<boolean> {
  if (deviceIds.length === 0) return false;
  const result = await db.execute<{ missing: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM daily_stats s
      WHERE s.device_id = ANY(${sql.param(deviceIds)}::uuid[]) AND s.points > 0
        AND s.date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${keptPointInDay(sql`s`, sql`${timezone}`)}
        AND NOT EXISTS (SELECT 1 FROM heat_days h WHERE h.device_id = s.device_id AND h.day = s.date)
    ) AS missing
  `);
  return result.rows[0]?.missing === true;
}
