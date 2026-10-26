import type { TransportMode } from "@trail/contracts/transport";
import { haversineM } from "../tracks/haversine";
import type { MoveSeries } from "./moveSeries";
import { zeroCounts } from "./moveSeries";
import type { ManualTrip, MoveFeatures, StopCounts, WayShares } from "./pipelineTypes";
import type { ProcessingConfig } from "./processingConfig";
import { emptyShares } from "./wayFamily";
import { weightedQuantile } from "./weightedQuantile";

type FeaturesConfig = ProcessingConfig["features"];

const kmh = (metresPerSecond: number): number => metresPerSecond * 3.6;
const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Overland's trip modes in Trail's vocabulary. */
const tripModes: Readonly<Record<string, TransportMode>> = {
  walk: "walking",
  run: "running",
  bicycle: "cycling",
  scooter: "cycling",
  car: "car",
  taxi: "car",
  motorcycle: "car",
  car_share: "car",
  bus: "bus",
  tram: "tram",
  metro: "metro",
  train: "train",
  boat: "boat",
  plane: "plane",
};

/**
 * Features of points `first..last` of a move (docs/architecture.md §17.3,
 * inferred, step 2), from its series: what the mode rules judge. Called for
 * whole moves and for the splitting stage's sliding windows.
 */
export function extractFeatures(
  series: MoveSeries,
  range: { first: number; last: number; withEnds: boolean },
  trips: readonly ManualTrip[],
  config: FeaturesConfig,
): MoveFeatures {
  const { first, last } = range;
  const hasMap = series.stopsAt(first) !== null;
  const { points } = series;
  const start = points[first];
  const end = points[last];
  const durationS = start !== undefined && end !== undefined ? end.t - start.t : 0;

  let distanceM = 0;
  const speeds: number[] = [];
  const weights: number[] = [];
  const shares = emptyShares();
  let sharedDistance = 0;
  let nearTram = 0;
  let nearCycleway = 0;
  let nearFoot = 0;
  let samples = 0;
  let railSamples = 0;
  let motorwaySamples = 0;
  const motion = { stationary: 0, walking: 0, running: 0, cycling: 0, automotive: 0, coverage: 0 };
  for (let k = first + 1; k <= last; k += 1) {
    const dt = series.dt[k] ?? 0;
    const distance = series.distance[k] ?? 0;
    distanceM += distance;
    if (dt > 0) {
      speeds.push(series.speed[k] ?? 0);
      weights.push(dt);
    }
    const family = series.families[k];
    if (family !== null && family !== undefined) {
      for (const [key, share] of Object.entries(family) as [keyof WayShares, number][]) {
        shares[key] += share * distance;
      }
      sharedDistance += distance;
    }
    const half = distance / 2;
    nearTram += half * ((series.nearTram[k - 1] ?? 0) + (series.nearTram[k] ?? 0));
    nearCycleway += half * ((series.nearCycleway[k - 1] ?? 0) + (series.nearCycleway[k] ?? 0));
    nearFoot += half * ((series.nearFoot[k - 1] ?? 0) + (series.nearFoot[k] ?? 0));
    samples += series.corridorSamples[k] ?? 0;
    railSamples += series.corridorRail[k] ?? 0;
    motorwaySamples += series.corridorMotorway[k] ?? 0;
    const activity = series.activity[k];
    if (activity !== null && activity !== undefined) {
      motion[activity] += dt;
      motion.coverage += dt;
    }
  }
  if (durationS > 0) {
    for (const key of Object.keys(motion) as (keyof typeof motion)[]) {
      motion[key] = round(motion[key] / durationS);
    }
  }

  // Acceleration between consecutive dense intervals.
  let accelerationVariance: number | null = null;
  const accelerations: number[] = [];
  for (let k = first + 2; k <= last; k += 1) {
    const dtA = series.dt[k - 1] ?? 0;
    const dtB = series.dt[k] ?? 0;
    if (dtA <= 0 || dtB <= 0 || dtA > config.denseIntervalS || dtB > config.denseIntervalS)
      continue;
    accelerations.push(((series.speed[k] ?? 0) - (series.speed[k - 1] ?? 0)) / ((dtA + dtB) / 2));
  }
  if (accelerations.length >= 10) {
    const mean = accelerations.reduce((sum, value) => sum + value, 0) / accelerations.length;
    accelerationVariance = round(
      accelerations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / accelerations.length,
    );
  }

  const usable = speeds.length > 0;
  const median = usable ? weightedQuantile(speeds, weights, 0.5) : 0;
  const p85 = usable ? weightedQuantile(speeds, weights, 0.85) : 0;
  const max = usable ? weightedQuantile(speeds, weights, 0.98) : 0;

  let ways: WayShares | null = null;
  if (series.mapped && sharedDistance > 0) {
    ways = emptyShares();
    for (const key of Object.keys(ways) as (keyof WayShares)[])
      ways[key] = round(shares[key] / sharedDistance);
  } else if (series.mapped) {
    ways = emptyShares();
  }

  let dwells: StopCounts | null = null;
  let ends: StopCounts | null = null;
  if (hasMap) {
    dwells = zeroCounts();
    for (const dwell of series.dwells) {
      if (dwell.first <= first || dwell.last >= last) continue;
      for (const key of Object.keys(dwells) as (keyof StopCounts)[]) dwells[key] += dwell.near[key];
    }
    ends = zeroCounts();
    if (range.withEnds) {
      const atStart = series.stopsAt(first) ?? zeroCounts();
      const atEnd = series.stopsAt(last) ?? zeroCounts();
      for (const key of Object.keys(ends) as (keyof StopCounts)[])
        ends[key] = atStart[key] + atEnd[key];
    }
  }

  let passed: MoveFeatures["passed"] = null;
  if (hasMap) {
    const buses = new Set<string>();
    const trams = new Set<string>();
    for (let position = first; position <= last; position += 1) {
      const bus = series.busStopPassed[position];
      const tram = series.tramStopPassed[position];
      if (bus !== null && bus !== undefined) buses.add(bus);
      if (tram !== null && tram !== undefined) trams.add(tram);
    }
    passed = { busStop: buses.size, tramStop: trams.size };
  }

  // An Overland trip that covers most of the range names the mode.
  let tripMode: TransportMode | null = null;
  if (start !== undefined && end !== undefined && durationS > 0) {
    let bestOverlap = 0;
    for (const trip of trips) {
      const overlap = Math.min(trip.endedAt, end.t) - Math.max(trip.startedAt, start.t);
      const mode = tripModes[trip.mode];
      if (
        mode !== undefined &&
        overlap >= config.tripOverlapShare * durationS &&
        overlap > bestOverlap
      ) {
        bestOverlap = overlap;
        tripMode = mode;
      }
    }
  }

  // Altitude: the highest reading and the fastest climb over at least `climbMinIntervalS`.
  let maxAltitude: number | null = null;
  let climb: number | null = null;
  let anchor: { t: number; altitude: number } | null = null;
  for (let position = first; position <= last; position += 1) {
    const point = points[position];
    if (
      point === undefined ||
      point.altitude === null ||
      point.verticalAccuracy === null ||
      point.verticalAccuracy > config.maxVerticalAccuracyM
    ) {
      continue;
    }
    maxAltitude = Math.max(maxAltitude ?? point.altitude, point.altitude);
    if (anchor === null) anchor = { t: point.t, altitude: point.altitude };
    else if (point.t - anchor.t >= config.climbMinIntervalS) {
      const rate = (point.altitude - anchor.altitude) / (point.t - anchor.t);
      climb = Math.max(climb ?? rate, rate);
      anchor = { t: point.t, altitude: point.altitude };
    }
  }

  let extentM = 0;
  if (start !== undefined) {
    for (let position = first + 1; position <= last; position += 1) {
      const point = points[position];
      if (point !== undefined) extentM = Math.max(extentM, haversineM(start, point));
    }
  }

  const nearShare = (value: number) => (distanceM > 0 ? round(value / distanceM) : 0);
  return {
    durationS,
    distanceM: round(distanceM, 1),
    points: last - first + 1,
    speed: {
      median: round(kmh(median), 2),
      p85: round(kmh(p85), 2),
      max: round(kmh(max), 2),
      average: round(durationS > 0 ? kmh(distanceM / durationS) : 0, 2),
    },
    accelerationVariance,
    ways,
    near: hasMap
      ? { tram: nearShare(nearTram), cycleway: nearShare(nearCycleway), foot: nearShare(nearFoot) }
      : null,
    corridor: !hasMap
      ? null
      : {
          rail: samples > 0 ? round(railSamples / samples) : 0,
          motorway: samples > 0 ? round(motorwaySamples / samples) : 0,
          samples,
        },
    dwells,
    ends,
    passed,
    motion,
    tripMode,
    altitude: {
      maxM: maxAltitude === null ? null : round(maxAltitude, 1),
      climbMs: climb === null ? null : round(climb, 2),
    },
    extentM: round(extentM, 1),
  };
}
