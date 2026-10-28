import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { maxExtensionMs, seamPoints } from "./windowData";

/** The most one pass works out (`ProcessingConfig.passes`). */
interface PassBudget {
  readonly maxPoints: number;
  readonly maxSpanS: number;
}

interface Span {
  from: Date;
  to: Date;
}

const instant = (value: string): Date => new Date(toIso(value));

/** How many points the span holds, and its first and last. */
async function pointsIn(
  tx: Executor,
  deviceId: string,
  span: Span,
): Promise<{ count: number; first: Date | null; last: Date | null }> {
  const result = await tx.execute<{ count: number; first: string | null; last: string | null }>(sql`
    SELECT count(*)::int AS count, min(recorded_at)::text AS first, max(recorded_at)::text AS last
    FROM locations
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${span.from.toISOString()}::timestamptz
      AND recorded_at <= ${span.to.toISOString()}::timestamptz
  `);
  const row = result.rows[0];
  return {
    count: row?.count ?? 0,
    first: row?.first == null ? null : instant(row.first),
    last: row?.last == null ? null : instant(row.last),
  };
}

/**
 * Where the newest part of the span that fits the budget can start at the
 * earliest: the point from the end that leaves the window the points it keeps
 * for its seams (`seamPoints`), or the first point within `maxSpanS` of the
 * last, whichever is later. Null when the whole span fits.
 */
async function budgetStart(
  tx: Executor,
  deviceId: string,
  span: Span,
  points: { count: number; first: Date | null; last: Date | null },
  budget: PassBudget,
): Promise<Date | null> {
  const { count, first, last } = points;
  const capacity = budget.maxPoints - seamPoints;
  const starts: Date[] = [];
  if (count > capacity) {
    const result = await tx.execute<{ at: string }>(sql`
      SELECT recorded_at::text AS at FROM locations
      WHERE device_id = ${deviceId}
        AND recorded_at >= ${span.from.toISOString()}::timestamptz
        AND recorded_at <= ${span.to.toISOString()}::timestamptz
      ORDER BY recorded_at DESC
      OFFSET ${capacity - 1} LIMIT 1
    `);
    const row = result.rows[0];
    if (row !== undefined) starts.push(instant(row.at));
  }
  if (
    first !== null &&
    last !== null &&
    last.getTime() - first.getTime() > budget.maxSpanS * 1000
  ) {
    const result = await tx.execute<{ at: string | null }>(sql`
      SELECT min(recorded_at)::text AS at FROM locations
      WHERE device_id = ${deviceId}
        AND recorded_at >= ${new Date(last.getTime() - budget.maxSpanS * 1000).toISOString()}::timestamptz
        AND recorded_at <= ${span.to.toISOString()}::timestamptz
    `);
    const at = result.rows[0]?.at ?? null;
    if (at !== null) starts.push(instant(at));
  }
  if (starts.length === 0) return null;
  return new Date(Math.max(...starts.map((start) => start.getTime())));
}

/**
 * The point from which the newest part of the span holds half of the points
 * from `start` on: a split nearer the end would make a pass of a few points.
 */
async function halfwayFrom(tx: Executor, deviceId: string, span: Span, start: Date): Promise<Date> {
  const range = sql`device_id = ${deviceId}
    AND recorded_at >= ${start.toISOString()}::timestamptz
    AND recorded_at <= ${span.to.toISOString()}::timestamptz`;
  const counted = await tx.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM locations WHERE ${range}`,
  );
  const half = Math.max(1, Math.ceil((counted.rows[0]?.count ?? 0) / 2));
  const result = await tx.execute<{ at: string }>(sql`
    SELECT recorded_at::text AS at FROM locations WHERE ${range}
    ORDER BY recorded_at DESC OFFSET ${half - 1} LIMIT 1
  `);
  const row = result.rows[0];
  return row === undefined ? start : instant(row.at);
}

/**
 * Where to split: the end of the largest recording gap longer than `gapS` —
 * the night the phone slept through — that leaves a newer part within the
 * budget (it ends at `start` or later) holding at least half of the points
 * from `start` on, the older of equal ones, with the point before it
 * (`before`); else `start` itself, the budget's point boundary.
 */
async function splitPoint(
  tx: Executor,
  deviceId: string,
  span: Span,
  start: Date,
  gapS: number,
): Promise<{ at: Date; before: Date | null }> {
  const halfway = await halfwayFrom(tx, deviceId, span, start);
  // From the point before `start`: a gap that ends at `start` counts too. One scan of the newer
  // part. A gap right after a point at the span's very start would leave an older part of no time.
  const result = await tx.execute<{ at: string; before: string }>(sql`
    WITH before AS (
      SELECT recorded_at FROM locations
      WHERE device_id = ${deviceId}
        AND recorded_at >= ${span.from.toISOString()}::timestamptz
        AND recorded_at < ${start.toISOString()}::timestamptz
      ORDER BY recorded_at DESC LIMIT 1
    ), newer AS (
      SELECT recorded_at, lag(recorded_at) OVER (ORDER BY recorded_at) AS before
      FROM locations
      WHERE device_id = ${deviceId}
        AND recorded_at >= coalesce((SELECT recorded_at FROM before), ${start.toISOString()}::timestamptz)
        AND recorded_at <= ${span.to.toISOString()}::timestamptz
    )
    SELECT recorded_at::text AS at, before::text FROM newer
    WHERE recorded_at >= ${start.toISOString()}::timestamptz
      AND recorded_at <= ${halfway.toISOString()}::timestamptz
      AND recorded_at - before > ${gapS}::integer * interval '1 second'
      AND before > ${span.from.toISOString()}::timestamptz
    ORDER BY recorded_at - before DESC, recorded_at
    LIMIT 1
  `);
  const row = result.rows[0];
  return row === undefined
    ? { at: start, before: null }
    : { at: instant(row.at), before: instant(row.before) };
}

/**
 * A job too big for one pass (docs/architecture.md §17.4) — more raw points
 * than the budget, or points spanning longer than it — is split in the pass's
 * own transaction, before anything is read: the pass goes on with the newest
 * part, which fits, and the older part is queued, to be split again when it
 * is taken. The split falls in the largest recording gap of more than
 * `gapSplitS` that leaves the newest part within the budget and at least
 * half of it — the older part ends at the point before the gap, and the
 * newer part's pass reaches back over it to see both its ends — else at the
 * budget's point boundary, where the point at the split is the newer part's
 * first and the older part's last, so that the parts meet. Either way the
 * older part holds fewer points than the job: every split makes headway. An
 * older part of the one point before the gap is no part: the newer part's
 * pass takes it in with its step back across the gap. Counting is one range
 * of the primary key; the gaps are looked for in the newest part only.
 */
export async function splitJob(
  tx: Executor,
  deviceId: string,
  span: Span,
  options: { budget: PassBudget; gapSplitS: number },
): Promise<{ span: Span; older: Span | null }> {
  const points = await pointsIn(tx, deviceId, span);
  const start = await budgetStart(tx, deviceId, span, points, options.budget);
  if (start === null || points.last === null) return { span, older: null };
  const { at, before } = await splitPoint(tx, deviceId, span, start, options.gapSplitS);
  // Two points further apart than a pass may span, the first at the job's start: no split leaves
  // an older part of its own, and two points are no work.
  if (before === null && at >= points.last) return { span, older: null };
  const newer = { from: at, to: span.to };
  // The job's first point alone before the gap: the newer pass steps back to it (two days at most).
  const alone =
    before !== null &&
    points.first !== null &&
    before.getTime() === points.first.getTime() &&
    at.getTime() - before.getTime() <= maxExtensionMs;
  return { span: newer, older: alone ? null : { from: span.from, to: before ?? at } };
}
