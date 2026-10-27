import type { InsightsBucket, InsightsMode, InsightsPeriod } from "@trail/contracts/insights";
import type { TransportMode, WayKind } from "@trail/contracts/transport";
import { hourParts } from "./hourParts";
import type { InsightMove } from "./insightMoves";
import { bucketOf, bucketsOf } from "./insightsPeriod";
import { roundMetres, roundSeconds, shareOf, speedKmh } from "./insightsRounding";
import type { LocalHour } from "./localHours";
import { emptyRoadTally, kindRows, type RoadTally, tallyRoads } from "./roadTally";
import { speedHistogram } from "./speedHistogram";
import { topMoves, typicalSpeedKmh } from "./topMoves";

/** Rail modes, and where their moves halt along the way (`features.dwells`). */
const railStops: Partial<Record<TransportMode, "station" | "tramStop" | "subway">> = {
  train: "station",
  tram: "tramStop",
  metro: "subway",
};

/** The kinds of way that are railway track. */
const railKinds: readonly WayKind[] = ["rail", "light_rail", "tram", "subway"];

interface Sum {
  distanceM: number;
  seconds: number;
}

const add = (sum: Sum, distanceM: number, seconds: number) => {
  sum.distanceM += distanceM;
  sum.seconds += seconds;
};

/** A part of the mapped distance on some kinds of way, or null for modes it does not concern. */
function onWays(tally: RoadTally, kinds: readonly WayKind[], applies: boolean) {
  if (!applies) return null;
  const distance = kinds.reduce((sum, kind) => sum + (tally.kinds.get(kind) ?? 0), 0);
  return { distanceM: roundMetres(distance), share: shareOf(distance, tally.mappedM) };
}

/**
 * One mode in a period (docs/architecture.md §8.7). Distance and time — the
 * totals, the steps, the hours of the day, the weekdays and the kinds of way
 * — are prorated over the period's hours; what describes whole moves (their
 * number, the typical speed, the longest and fastest, the histogram, the top
 * moves, the halts at stations) takes the moves that started in the period.
 * `moves` are the mode's moves overlapping the period.
 */
export function buildModeInsights(input: {
  timezone: string;
  mode: TransportMode;
  period: InsightsPeriod;
  bucket: InsightsBucket;
  hours: readonly LocalHour[];
  moves: readonly InsightMove[];
  pending: boolean;
}): InsightsMode {
  const { mode, hours } = input;
  const first = hours[0]?.start ?? 0;
  const end = hours.at(-1)?.end ?? 0;
  const total: Sum = { distanceM: 0, seconds: 0 };
  const byBucket = new Map<string, Sum>();
  const byHour = Array.from({ length: 24 }, (): Sum => ({ distanceM: 0, seconds: 0 }));
  const byWeekday = Array.from({ length: 7 }, (): Sum => ({ distanceM: 0, seconds: 0 }));
  const roads = emptyRoadTally();
  const started: InsightMove[] = [];
  for (const move of input.moves) {
    if (move.mode !== mode) continue;
    if (move.startMs >= first && move.startMs < end) started.push(move);
    for (const part of hourParts(move, hours)) {
      add(total, part.distanceM, part.seconds);
      const key = bucketOf(part.hour.date, input.bucket);
      const step = byBucket.get(key) ?? { distanceM: 0, seconds: 0 };
      add(step, part.distanceM, part.seconds);
      byBucket.set(key, step);
      const hour = byHour[part.hour.hour];
      if (hour !== undefined) add(hour, part.distanceM, part.seconds);
      const weekday = byWeekday[part.hour.weekday - 1];
      if (weekday !== undefined) add(weekday, part.distanceM, part.seconds);
      tallyRoads(roads, part.distanceM, move.wayKinds);
    }
  }

  const stopKind = railStops[mode];
  const top = topMoves(started);
  const rounded = (sum: Sum) => ({
    distanceM: roundMetres(sum.distanceM),
    durationS: roundSeconds(sum.seconds),
  });
  const buckets = bucketsOf(input.period, input.bucket);
  return {
    timezone: input.timezone,
    mode,
    period: { ...input.period, bucket: input.bucket, buckets },
    totals: {
      ...rounded(total),
      moves: started.length,
      avgSpeedKmh: speedKmh(total.distanceM, total.seconds),
      typicalSpeedKmh: typicalSpeedKmh(started),
      longest: top.longest[0] ?? null,
      fastest: top.fastest[0] ?? null,
    },
    series: buckets.map((bucket) => ({
      bucket,
      ...rounded(byBucket.get(bucket) ?? { distanceM: 0, seconds: 0 }),
    })),
    byHour: byHour.map((sum, hour) => ({ hour, ...rounded(sum) })),
    byWeekday: byWeekday.map((sum, index) => ({ weekday: index + 1, ...rounded(sum) })),
    roads: {
      distanceM: roundMetres(roads.distanceM),
      mappedM: roundMetres(roads.mappedM),
      kinds: kindRows(roads),
    },
    rail: onWays(roads, railKinds, stopKind !== undefined),
    ferry: onWays(roads, ["ferry"], mode === "boat"),
    stationStops:
      stopKind === undefined
        ? null
        : started.reduce((sum, move) => sum + (move.dwells?.[stopKind] ?? 0), 0),
    speedHistogram: speedHistogram(
      started.flatMap((move) => (move.medianKmh === null ? [] : [move.medianKmh])),
    ),
    topMoves: top,
    pending: input.pending,
  };
}
