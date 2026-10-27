import type {
  InsightsBucket,
  InsightsOverview,
  InsightsPeriod,
  InsightsTotals,
} from "@trail/contracts/insights";
import { type TransportMode, transportModes } from "@trail/contracts/transport";
import { hourParts } from "./hourParts";
import type { InsightMove } from "./insightMoves";
import { bucketOf, bucketsOf } from "./insightsPeriod";
import { roundMetres, roundSeconds, shareOf, speedKmh } from "./insightsRounding";
import type { LocalHour } from "./localHours";

interface Sum {
  distanceM: number;
  seconds: number;
  moves: number;
}

const emptySum = (): Sum => ({ distanceM: 0, seconds: 0, moves: 0 });

interface PeriodSums {
  total: Sum;
  byMode: Map<TransportMode, Sum>;
  /** Per step, per mode. */
  byBucket: Map<string, Map<TransportMode, Sum>>;
  activeDates: Set<string>;
}

/** Whether a move started inside the hours (the period): counts are of what started inside. */
const startsIn = (move: InsightMove, hours: readonly LocalHour[]): boolean => {
  const first = hours[0];
  const last = hours.at(-1);
  return (
    first !== undefined &&
    last !== undefined &&
    move.startMs >= first.start &&
    move.startMs < last.end
  );
};

function sumUp(
  moves: readonly InsightMove[],
  hours: readonly LocalHour[],
  bucket: InsightsBucket,
): PeriodSums {
  const sums: PeriodSums = {
    total: emptySum(),
    byMode: new Map(),
    byBucket: new Map(),
    activeDates: new Set(),
  };
  for (const move of moves) {
    let mode = sums.byMode.get(move.mode);
    const parts = hourParts(move, hours);
    const counted = startsIn(move, hours);
    if (parts.length === 0 && !counted) continue;
    if (mode === undefined) {
      mode = emptySum();
      sums.byMode.set(move.mode, mode);
    }
    if (counted) {
      mode.moves += 1;
      sums.total.moves += 1;
    }
    for (const part of parts) {
      mode.distanceM += part.distanceM;
      mode.seconds += part.seconds;
      sums.total.distanceM += part.distanceM;
      sums.total.seconds += part.seconds;
      if (part.seconds > 0) sums.activeDates.add(part.hour.date);
      const key = bucketOf(part.hour.date, bucket);
      let modes = sums.byBucket.get(key);
      if (modes === undefined) {
        modes = new Map();
        sums.byBucket.set(key, modes);
      }
      const step = modes.get(move.mode) ?? emptySum();
      step.distanceM += part.distanceM;
      step.seconds += part.seconds;
      modes.set(move.mode, step);
    }
  }
  return sums;
}

const totalsOf = (sums: PeriodSums, stops: number): InsightsTotals => ({
  distanceM: roundMetres(sums.total.distanceM),
  durationS: roundSeconds(sums.total.seconds),
  moves: sums.total.moves,
  stops,
  activeDays: sums.activeDates.size,
});

/**
 * The overview of a period (docs/architecture.md §8.7): totals, the modes'
 * parts with their change since the previous period, and the distance and
 * time per step and mode. `moves` holds the moves of both periods; each
 * period takes the parts of them inside its own hours.
 */
export function buildOverview(input: {
  timezone: string;
  period: InsightsPeriod;
  bucket: InsightsBucket;
  previous: InsightsPeriod;
  hours: readonly LocalHour[];
  previousHours: readonly LocalHour[];
  moves: readonly InsightMove[];
  stops: { current: number; previous: number };
  pending: boolean;
}): InsightsOverview {
  const current = sumUp(input.moves, input.hours, input.bucket);
  const before = sumUp(input.moves, input.previousHours, input.bucket);
  const order = (mode: TransportMode) => transportModes.indexOf(mode);
  const modes = [...current.byMode.entries()]
    .sort(([a, x], [b, y]) => y.distanceM - x.distanceM || order(a) - order(b))
    .map(([mode, sum]) => ({
      mode,
      distanceM: roundMetres(sum.distanceM),
      durationS: roundSeconds(sum.seconds),
      moves: sum.moves,
      avgSpeedKmh: speedKmh(sum.distanceM, sum.seconds),
      share: shareOf(sum.distanceM, current.total.distanceM),
      deltaDistanceM: roundMetres(sum.distanceM - (before.byMode.get(mode)?.distanceM ?? 0)),
    }));
  const buckets = bucketsOf(input.period, input.bucket);
  const series = buckets.flatMap((key) => {
    const byMode = current.byBucket.get(key);
    if (byMode === undefined) return [];
    return transportModes.flatMap((mode) => {
      const sum = byMode.get(mode);
      if (sum === undefined || (sum.seconds <= 0 && sum.distanceM <= 0)) return [];
      return [
        {
          bucket: key,
          mode,
          distanceM: roundMetres(sum.distanceM),
          durationS: roundSeconds(sum.seconds),
        },
      ];
    });
  });
  return {
    timezone: input.timezone,
    period: { ...input.period, bucket: input.bucket, buckets },
    previous: { ...input.previous, totals: totalsOf(before, input.stops.previous) },
    totals: totalsOf(current, input.stops.current),
    modes,
    series,
    pending: input.pending,
  };
}
