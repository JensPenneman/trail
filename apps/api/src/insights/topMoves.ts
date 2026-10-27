import type { InsightsMove } from "@trail/contracts/insights";
import type { InsightMove } from "./insightMoves";
import { roundKmh, roundMetres, roundSeconds, speedKmh } from "./insightsRounding";

/** A move as Insights lists it: times, distance and speeds, never where it went. */
function toInsightsMove(move: InsightMove): InsightsMove {
  const seconds = Math.max(0, (move.endMs - move.startMs) / 1000);
  return {
    segmentId: move.id,
    deviceId: move.deviceId,
    startedAt: new Date(move.startMs).toISOString(),
    endedAt: new Date(move.endMs).toISOString(),
    distanceM: roundMetres(move.distanceM),
    durationS: roundSeconds(seconds),
    avgSpeedKmh: speedKmh(move.distanceM, seconds),
    maxSpeedKmh: roundKmh((move.maxSpeedMs ?? 0) * 3.6),
  };
}

/** Ties go to the earlier move, then the lower id, so the lists never shuffle. */
const steady = (a: InsightMove, b: InsightMove): number =>
  a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The longest, the fastest (top speed) and the most recent moves, `count` of each. */
export function topMoves(
  moves: readonly InsightMove[],
  count = 5,
): { longest: InsightsMove[]; fastest: InsightsMove[]; recent: InsightsMove[] } {
  const pick = (compare: (a: InsightMove, b: InsightMove) => number) =>
    [...moves].sort(compare).slice(0, count).map(toInsightsMove);
  return {
    longest: pick((a, b) => b.distanceM - a.distanceM || steady(a, b)),
    fastest: pick((a, b) => (b.maxSpeedMs ?? 0) - (a.maxSpeedMs ?? 0) || steady(a, b)),
    recent: pick((a, b) => -steady(a, b)),
  };
}

/**
 * How fast one usually goes: the median of the moves' median speeds, each
 * weighted by its time, so a long ride counts more than a short hop. Null
 * without a move that has both.
 */
export function typicalSpeedKmh(moves: readonly InsightMove[]): number | null {
  const weighted = moves
    .map((move) => ({ speed: move.medianKmh, weight: move.endMs - move.startMs }))
    .filter(
      (entry): entry is { speed: number; weight: number } =>
        entry.speed !== null && Number.isFinite(entry.speed) && entry.weight > 0,
    )
    .sort((a, b) => a.speed - b.speed);
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let reached = 0;
  for (const entry of weighted) {
    reached += entry.weight;
    if (reached >= total / 2) return roundKmh(entry.speed);
  }
  return null;
}
