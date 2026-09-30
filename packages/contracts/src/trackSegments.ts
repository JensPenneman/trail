import type { TrackPoint } from "./track";

/** A pause longer than this (seconds) starts a new segment: no line is drawn across it. */
export const trackGapSeconds = 600;

/**
 * Splits a time-ordered track into continuous segments at recording gaps, so a
 * phone that stopped logging does not draw a straight line to where it
 * resumed. The API simplifies per segment; the web app draws per segment.
 */
export function trackSegments(
  points: readonly TrackPoint[],
  gapSeconds: number = trackGapSeconds,
): TrackPoint[][] {
  const segments: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  let previousTime: number | undefined;
  for (const point of points) {
    const time = point[2];
    if (previousTime !== undefined && time - previousTime > gapSeconds && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push(point);
    previousTime = time;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}
