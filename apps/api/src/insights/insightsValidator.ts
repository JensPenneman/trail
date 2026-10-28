import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { stayPartsSql } from "../processing/stayParts";
import type { InsightsScope } from "./insightsScope";

interface ValidatorRow extends Record<string, unknown> {
  segments: number;
  computed_at: string | null;
  min_version: number | null;
  max_version: number | null;
  starts: string | null;
  ends: string | null;
  points: string | null;
  pending: boolean;
}

/**
 * What an Insights answer is made of, read before its moves
 * (docs/architecture.md §8.9): the scope — devices, period, time zone — and
 * of the segments of the stays overlapping `[startMs, endMs)` (the overview's
 * reaches back over the period before) — every part of a stay the answers
 * count as one stop, wherever it lies (`stayPartsSql`) — their count, newest
 * write (`computed_at`, which a pass and a mode correction move), versions and
 * the sums of their bounds and points, and whether a window waits for
 * processing over the period or those stays — the answers' own `pending`.
 * One statement.
 */
export async function insightsValidator(
  db: Executor,
  scope: InsightsScope,
  range: { startMs: number; endMs: number },
): Promise<unknown> {
  const period = [scope.timezone, scope.period, scope.deviceIds];
  if (scope.deviceIds.length === 0) return period;
  const ids = sql`${sql.param(scope.deviceIds)}::uuid[]`;
  const start = new Date(range.startMs).toISOString();
  const end = new Date(range.endMs).toISOString();
  const result = await db.execute<ValidatorRow>(sql`
    WITH parts AS (
      SELECT * FROM ${stayPartsSql(ids, sql`${start}::timestamptz`, sql`${end}::timestamptz`)} stays
      WHERE stay_from < ${end}::timestamptz AND stay_to >= ${start}::timestamptz
    )
    SELECT count(*)::int AS segments, max(s.computed_at)::text AS computed_at,
      min(s.version)::int AS min_version, max(s.version)::int AS max_version,
      sum(extract(epoch FROM s.started_at))::text AS starts,
      sum(extract(epoch FROM s.ended_at))::text AS ends,
      sum(s.point_count)::text AS points,
      EXISTS (
        SELECT 1 FROM processing_queue q
        WHERE q.device_id = ANY(${ids}) AND q.missing_tiles IS NULL
          AND q.from_at < greatest(${scope.end.toISOString()}::timestamptz, max(s.stay_to))
          AND q.to_at > least(${scope.start.toISOString()}::timestamptz, min(s.stay_from))
      ) AS pending
    FROM parts s
  `);
  return [...period, result.rows[0] ?? null];
}
