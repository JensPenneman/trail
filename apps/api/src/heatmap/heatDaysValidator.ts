import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { heatGeneration } from "./heatGeneration";

interface Row extends Record<string, unknown> {
  rows: number;
  computed: string | null;
  points: string | null;
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
  const result = await db.execute<Row>(sql`
    SELECT count(*)::int AS rows, max(computed_at)::text AS computed, sum(points)::text AS points
    FROM heat_days
    WHERE device_id = ANY(${sql.param(deviceIds)}::uuid[]) AND z = 12
      AND day BETWEEN ${period.from}::date AND ${period.to}::date
  `);
  const row = result.rows[0];
  return [heatGeneration(), row?.rows ?? 0, row?.computed ?? null, row?.points ?? null];
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
): Promise<boolean> {
  if (deviceIds.length === 0) return false;
  const result = await db.execute<{ missing: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM daily_stats s
      WHERE s.device_id = ANY(${sql.param(deviceIds)}::uuid[]) AND s.points > 0
        AND s.date BETWEEN ${period.from}::date AND ${period.to}::date
        AND NOT EXISTS (SELECT 1 FROM heat_days h WHERE h.device_id = s.device_id AND h.day = s.date)
    ) AS missing
  `);
  return result.rows[0]?.missing === true;
}
