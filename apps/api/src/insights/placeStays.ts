import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { servedSegments } from "../transport/servedSegments";

/** A stay as Places reads it: when, and the time-weighted middle of its points. */
export interface PlaceStay {
  deviceId: string;
  startMs: number;
  endMs: number;
  lat: number;
  lon: number;
}

interface StayRow extends Record<string, unknown> {
  device_id: string;
  start_ms: number;
  end_ms: number;
  lat: number;
  lon: number;
}

/**
 * The stops of `deviceIds` overlapping `[startMs, endMs)`, a stay one stop
 * (`servedSegments`, which reaches back two weeks for the parts of a long
 * stay), by device and start. Their middles are the coordinates Places
 * answers with; nothing else of a position is read.
 */
export async function loadPlaceStays(
  db: Executor,
  deviceIds: readonly string[],
  range: { startMs: number; endMs: number },
): Promise<PlaceStay[]> {
  if (deviceIds.length === 0) return [];
  const from = new Date(range.startMs);
  const to = new Date(range.endMs);
  const result = await db.execute<StayRow>(sql`
    SELECT s.device_id,
      (extract(epoch FROM s.started_at) * 1000)::float8 AS start_ms,
      (extract(epoch FROM s.ended_at) * 1000)::float8 AS end_ms,
      s.centroid_lat AS lat, s.centroid_lon AS lon
    FROM ${servedSegments(deviceIds, { from, to })}
    WHERE s.kind = 'stop'
      AND s.started_at < ${to.toISOString()}::timestamptz
      AND s.ended_at > ${from.toISOString()}::timestamptz
      AND s.centroid_lat IS NOT NULL AND s.centroid_lon IS NOT NULL
    ORDER BY s.device_id, s.started_at
  `);
  return result.rows.map((row) => ({
    deviceId: row.device_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    lat: row.lat,
    lon: row.lon,
  }));
}
