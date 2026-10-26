import type { TrackPoint } from "@trail/contracts/track";
import { trackGapSeconds } from "@trail/contracts/trackSegments";

export interface PositionAtTime {
  lon: number;
  lat: number;
  /** m/s, null when unknown. */
  speed: number | null;
  /** Epoch seconds of the nearest recorded point. */
  recordedAt: number;
  /** True when the position lies between two recorded points. */
  interpolated: boolean;
}

/**
 * Where a device was at `time` (epoch seconds), from a time-ordered track.
 * Between two points of the same segment the position is interpolated; in a
 * recording gap, or outside the recorded span, there is no answer.
 */
export function positionAt(points: readonly TrackPoint[], time: number): PositionAtTime | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || time < first[2] || time > last[2]) return null;
  let low = 0;
  let high = points.length - 1;
  // Last point at or before `time`.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = points[middle];
    if (candidate !== undefined && candidate[2] <= time) low = middle;
    else high = middle - 1;
  }
  const before = points[low];
  if (before === undefined) return null;
  const after = points[low + 1];
  if (before[2] === time || after === undefined) {
    return {
      lon: before[0],
      lat: before[1],
      speed: before[3],
      recordedAt: before[2],
      interpolated: false,
    };
  }
  if (after[2] - before[2] > trackGapSeconds) return null;
  const fraction = (time - before[2]) / (after[2] - before[2]);
  const nearest = fraction < 0.5 ? before : after;
  return {
    lon: before[0] + (after[0] - before[0]) * fraction,
    lat: before[1] + (after[1] - before[1]) * fraction,
    speed: nearest[3],
    recordedAt: nearest[2],
    interpolated: true,
  };
}
