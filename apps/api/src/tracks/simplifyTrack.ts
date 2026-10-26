import type { TrackPoint } from "@trail/contracts/track";
import { rdpImportance } from "./rdpImportance";

/** Anything drawable: longitude and latitude first. */
type Drawable = readonly [number, number, ...unknown[]];

/** Evenly spaced subset — only when segment end points alone exceed the budget. */
function evenSample<P extends Drawable>(points: readonly P[], maxPoints: number): P[] {
  const step = points.length / maxPoints;
  const sampled: P[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const point = points[Math.floor(index * step)];
    if (point !== undefined) sampled.push(point);
  }
  return sampled;
}

/**
 * Simplifies the parts of a track to at most `maxPoints` in total with one RDP
 * tolerance for all of them, part by part. The tolerance is chosen exactly:
 * sorting the points' RDP importances gives the smallest tolerance that fits
 * the budget (what a binary search over tolerances converges to). The end
 * points of every part are always kept — even when they alone exceed the
 * budget.
 */
export function simplifyParts<P extends Drawable>(
  parts: readonly (readonly P[])[],
  maxPoints: number,
): P[][] {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (total <= maxPoints) return parts.map((part) => [...part]);

  const endPoints = parts.reduce((sum, part) => sum + Math.min(part.length, 2), 0);
  const importances = parts.map((part) => rdpImportance(part));
  const interior = new Float64Array(total - endPoints);
  let offset = 0;
  for (const importance of importances) {
    for (let index = 1; index < importance.length - 1; index += 1) {
      interior[offset] = importance[index] ?? 0;
      offset += 1;
    }
  }
  interior.sort();
  const budget = Math.max(0, maxPoints - endPoints);
  // The (budget + 1)-th largest importance: only points strictly above it remain.
  const tolerance = interior[interior.length - 1 - budget] ?? Number.NEGATIVE_INFINITY;
  return parts.map((part, partIndex) => {
    const importance = importances[partIndex];
    return part.filter((_, index) => (importance?.[index] ?? 0) > tolerance);
  });
}

/**
 * Simplifies a track (split into segments) to at most `maxPoints` with one RDP
 * tolerance for the whole track (`simplifyParts`, flattened). If segment end
 * points alone exceed the budget, points are sampled evenly instead.
 */
export function simplifyTrack(
  segments: readonly (readonly TrackPoint[])[],
  maxPoints: number,
): TrackPoint[] {
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= maxPoints) return segments.flat();
  const endPoints = segments.reduce((sum, segment) => sum + Math.min(segment.length, 2), 0);
  if (endPoints > maxPoints) return evenSample(segments.flat(), maxPoints);
  return simplifyParts(segments, maxPoints).flat();
}
