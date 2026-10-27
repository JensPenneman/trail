import type { TransportMode, WayKind } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

/** A move as Insights reads it from `segments`: times, distance and a few features, no positions. */
export interface InsightMove {
  id: string;
  deviceId: string;
  /** The mode that counts (the person's, else the inferred one). */
  mode: TransportMode;
  startMs: number;
  endMs: number;
  distanceM: number;
  /** Top speed in m/s; null when unknown. */
  maxSpeedMs: number | null;
  /** The time-weighted median speed (`features.speed.median`), km/h; null when not stored. */
  medianKmh: number | null;
  /** `features.wayKinds`: null without map data or from before version 2 of the inference. */
  wayKinds: Partial<Record<WayKind, number>> | null;
  /** `features.dwells`: pauses near public transport stops; null without map data. */
  dwells: Partial<Record<"station" | "tramStop" | "subway", number>> | null;
}

interface MoveRow extends Record<string, unknown> {
  id: string;
  device_id: string;
  mode: TransportMode;
  start_ms: number;
  end_ms: number;
  distance_m: number;
  max_speed: number | null;
  median_kmh: number | null;
  way_kinds: Partial<Record<WayKind, number>> | null;
  dwells: Partial<Record<"station" | "tramStop" | "subway", number>> | null;
}

/**
 * The moves of `deviceIds` overlapping `[startMs, endMs)` — and ones without
 * duration at a time inside it — oldest first, optionally of one mode. Reads
 * the segments only: no points, no coordinates.
 */
export async function loadInsightMoves(
  db: Executor,
  deviceIds: readonly string[],
  range: { startMs: number; endMs: number },
  mode: TransportMode | null = null,
): Promise<InsightMove[]> {
  if (deviceIds.length === 0) return [];
  const start = new Date(range.startMs).toISOString();
  const end = new Date(range.endMs).toISOString();
  const result = await db.execute<MoveRow>(sql`
    SELECT s.id, s.device_id, coalesce(s.mode, 'unknown') AS mode,
      (extract(epoch FROM s.started_at) * 1000)::float8 AS start_ms,
      (extract(epoch FROM s.ended_at) * 1000)::float8 AS end_ms,
      s.distance_m, s.max_speed,
      (s.features->'speed'->>'median')::float8 AS median_kmh,
      s.features->'wayKinds' AS way_kinds,
      s.features->'dwells' AS dwells
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
    id: row.id,
    deviceId: row.device_id,
    mode: row.mode,
    startMs: row.start_ms,
    endMs: row.end_ms,
    distanceM: row.distance_m,
    maxSpeedMs: row.max_speed,
    medianKmh: row.median_kmh,
    wayKinds: row.way_kinds,
    dwells: row.dwells,
  }));
}

/** How many stops of `deviceIds` started in each of the ranges. */
export async function countStops(
  db: Executor,
  deviceIds: readonly string[],
  ranges: readonly { startMs: number; endMs: number }[],
): Promise<number[]> {
  if (deviceIds.length === 0) return ranges.map(() => 0);
  const counts: number[] = [];
  for (const range of ranges) {
    const result = await db.execute<{ stops: number }>(sql`
      SELECT count(*)::int AS stops FROM segments
      WHERE device_id = ANY(${sql.param(deviceIds)}::uuid[]) AND kind = 'stop'
        AND started_at >= ${new Date(range.startMs).toISOString()}::timestamptz
        AND started_at < ${new Date(range.endMs).toISOString()}::timestamptz
    `);
    counts.push(result.rows[0]?.stops ?? 0);
  }
  return counts;
}

/** When the first segment of `deviceIds` started (epoch ms), or null when there is none. */
export async function firstSegmentAt(
  db: Executor,
  deviceIds: readonly string[],
): Promise<number | null> {
  if (deviceIds.length === 0) return null;
  // One index lookup per device, rather than reading every segment of all of them.
  const result = await db.execute<{ first_ms: number | null }>(sql`
    SELECT (extract(epoch FROM min(first.started_at)) * 1000)::float8 AS first_ms
    FROM unnest(${sql.param(deviceIds)}::uuid[]) AS device(id)
    CROSS JOIN LATERAL (
      SELECT started_at FROM segments WHERE device_id = device.id ORDER BY started_at LIMIT 1
    ) first
  `);
  return result.rows[0]?.first_ms ?? null;
}
