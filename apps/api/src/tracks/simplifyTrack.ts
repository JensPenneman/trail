import type { TrackPoint } from "@trail/contracts/track";
import { rdpImportance } from "./rdpImportance";

/** Evenly spaced subset — only when segment end points alone exceed the budget. */
function evenSample(points: readonly TrackPoint[], maxPoints: number): TrackPoint[] {
  const step = points.length / maxPoints;
  const sampled: TrackPoint[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const point = points[Math.floor(index * step)];
    if (point !== undefined) sampled.push(point);
  }
  return sampled;
}

/**
 * Simplifies a track (split into segments) to at most `maxPoints` with one RDP
 * tolerance for the whole track. The tolerance is chosen exactly: sorting the
 * points' RDP importances gives the smallest tolerance that fits the budget
 * (what a binary search over tolerances converges to). Segment end points are
 * always kept.
 */
export function simplifyTrack(
  segments: readonly (readonly TrackPoint[])[],
  maxPoints: number,
): TrackPoint[] {
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= maxPoints) return segments.flat();

  const endPoints = segments.reduce((sum, segment) => sum + Math.min(segment.length, 2), 0);
  if (endPoints > maxPoints) return evenSample(segments.flat(), maxPoints);

  const importances = segments.map((segment) => rdpImportance(segment));
  const interior = new Float64Array(total - endPoints);
  let offset = 0;
  for (const importance of importances) {
    for (let index = 1; index < importance.length - 1; index += 1) {
      interior[offset] = importance[index] ?? 0;
      offset += 1;
    }
  }
  interior.sort();
  const budget = maxPoints - endPoints;
  // The (budget + 1)-th largest importance: only points strictly above it remain.
  const tolerance = interior[interior.length - 1 - budget] ?? Number.POSITIVE_INFINITY;

  const simplified: TrackPoint[] = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    const importance = importances[segmentIndex];
    if (importance === undefined) continue;
    for (const [index, point] of segment.entries()) {
      if ((importance[index] ?? 0) > tolerance) simplified.push(point);
    }
  }
  return simplified;
}
