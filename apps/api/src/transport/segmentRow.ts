import type { ChosenMode, Segment, TransportMode } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import { toIso } from "../db/toIso";

/** A `segments` row as the serving queries select it (`segmentColumns`). */
export interface SegmentRow extends Record<string, unknown> {
  id: string;
  device_id: string;
  kind: "stop" | "move";
  started_at: string;
  ended_at: string;
  duration_s: number;
  distance_m: number;
  mode: TransportMode | null;
  mode_inferred: TransportMode | null;
  mode_user: ChosenMode | null;
  confidence: number | null;
  review: boolean;
  max_speed: number | null;
  point_count: number;
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  centroid_lat: number;
  centroid_lon: number;
}

/** The columns of `SegmentRow`, for `SELECT ${segmentColumns} FROM segments s`. */
export const segmentColumns = sql.raw(`
  s.id, s.device_id, s.kind, s.started_at::text, s.ended_at::text, s.duration_s, s.distance_m,
  s.mode, s.mode_inferred, s.mode_user, s.confidence, s.review, s.max_speed, s.point_count,
  s.start_lat, s.start_lon, s.end_lat, s.end_lon, s.centroid_lat, s.centroid_lon
`);

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** A segment as the API shows it: a stop has no mode; review only while nobody set the mode. */
export function toSegment(row: SegmentRow): Segment {
  const move = row.kind === "move";
  return {
    id: row.id,
    deviceId: row.device_id,
    kind: row.kind,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    durationS: row.duration_s,
    distanceM: round(row.distance_m, 1),
    mode: move ? (row.mode_user ?? row.mode_inferred) : null,
    modeInferred: move ? row.mode_inferred : null,
    modeUser: move ? row.mode_user : null,
    confidence: move && row.confidence !== null ? round(row.confidence, 3) : null,
    needsReview: move && row.review && row.mode_user === null,
    averageSpeed: move
      ? row.duration_s > 0
        ? round(row.distance_m / row.duration_s, 2)
        : 0
      : null,
    maxSpeed: move ? round(row.max_speed ?? 0, 2) : null,
    pointCount: row.point_count,
    start: { lat: row.start_lat, lon: row.start_lon },
    end: { lat: row.end_lat, lon: row.end_lon },
    centroid: { lat: row.centroid_lat, lon: row.centroid_lon },
  };
}
