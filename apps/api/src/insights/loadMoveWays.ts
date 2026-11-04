import type { TransportMode } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

/** A move with the metres it was on each way (`features.wayTotals`), as Insights reads it. */
export interface MoveWays {
  mode: TransportMode;
  startMs: number;
  endMs: number;
  distanceM: number;
  /** `[wayId, metres]`; null without map data, and while the feature backfill has not reached it. */
  wayTotals: readonly (readonly [number, number])[] | null;
  /** Whether the move waits for the feature backfill (`features.wayTotals` is not there yet). */
  lacking: boolean;
}

interface Row extends Record<string, unknown> {
  mode: TransportMode;
  start_ms: number;
  end_ms: number;
  distance_m: number;
  way_totals: [number, number][] | null;
  lacking: boolean;
}

/** The moves of `deviceIds` overlapping `[startMs, endMs)`, as `loadInsightMoves` selects them. */
export async function loadMoveWays(
  db: Executor,
  deviceIds: readonly string[],
  range: { startMs: number; endMs: number },
  mode: TransportMode | null,
): Promise<MoveWays[]> {
  if (deviceIds.length === 0) return [];
  const start = new Date(range.startMs).toISOString();
  const end = new Date(range.endMs).toISOString();
  const result = await db.execute<Row>(sql`
    SELECT coalesce(s.mode, 'unknown') AS mode,
      (extract(epoch FROM s.started_at) * 1000)::float8 AS start_ms,
      (extract(epoch FROM s.ended_at) * 1000)::float8 AS end_ms,
      s.distance_m, s.features->'wayTotals' AS way_totals,
      NOT s.features ? 'wayTotals' AS lacking
    FROM segments s
    WHERE s.device_id = ANY(${sql.param(deviceIds)}::uuid[])
      AND s.kind = 'move'
      AND s.started_at < ${end}::timestamptz
      AND (s.ended_at > ${start}::timestamptz
        OR (s.ended_at = s.started_at AND s.started_at >= ${start}::timestamptz))
      ${mode === null ? sql`` : sql`AND coalesce(s.mode, 'unknown') = ${mode}`}
    ORDER BY s.started_at, s.device_id
  `);
  return result.rows.map((row) => ({
    mode: row.mode,
    startMs: row.start_ms,
    endMs: row.end_ms,
    distanceM: row.distance_m,
    wayTotals: Array.isArray(row.way_totals) ? row.way_totals : null,
    lacking: row.lacking,
  }));
}

/**
 * How many moves of `deviceIds` overlapping the range lack their way totals: part of the ETag of
 * the named roads (the backfill fills them without touching the segment's stamps).
 */
export async function countMovesLacking(
  db: Executor,
  deviceIds: readonly string[],
  range: { startMs: number; endMs: number },
): Promise<number> {
  if (deviceIds.length === 0) return 0;
  const result = await db.execute<{ lacking: number }>(sql`
    SELECT count(*)::int AS lacking FROM segments s
    WHERE s.device_id = ANY(${sql.param(deviceIds)}::uuid[]) AND s.kind = 'move'
      AND NOT s.features ? 'wayTotals'
      AND s.started_at < ${new Date(range.endMs).toISOString()}::timestamptz
      AND (s.ended_at > ${new Date(range.startMs).toISOString()}::timestamptz
        OR (s.ended_at = s.started_at
          AND s.started_at >= ${new Date(range.startMs).toISOString()}::timestamptz))
  `);
  return result.rows[0]?.lacking ?? 0;
}
