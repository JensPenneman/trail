import { haversineM } from "../tracks/haversine";
import type { AveragedPoint, RawPoint } from "./pipelineTypes";
import type { ProcessingConfig } from "./processingConfig";

type AveragingConfig = ProcessingConfig["averaging"];

/** m/s between two points; time stamps are whole, distinct seconds. */
const speedBetween = (a: RawPoint, b: RawPoint): number =>
  haversineM(a, b) / Math.max(1, Math.abs(b.t - a.t));

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Indices (into `candidates`) of spikes: a run of up to `maxRun` points that the
 * phone cannot have reached from the point before it nor left for the point
 * after it, while those two agree with each other. Requiring the neighbours to
 * agree keeps a fast but genuine series — a flight — from being taken apart.
 */
function findSpikes(
  points: readonly RawPoint[],
  candidates: readonly number[],
  config: AveragingConfig,
): Set<number> {
  const spikes = new Set<number>();
  const limit = config.spikeSpeedMs;
  const at = (position: number): RawPoint | undefined => {
    const index = candidates[position];
    return index === undefined ? undefined : points[index];
  };
  let previous = 0; // position of the last point known to be real
  let position = 1;
  // The first point: a spike when it disagrees with the next two, which agree with each other.
  const first = at(0);
  const second = at(1);
  const third = at(2);
  if (first !== undefined && second !== undefined && third !== undefined) {
    if (speedBetween(first, second) > limit && speedBetween(second, third) <= limit) {
      spikes.add(0);
      previous = 1;
      position = 2;
    }
  }
  while (position < candidates.length) {
    const before = at(previous);
    if (before === undefined) break;
    let run = 0;
    for (let length = 1; length <= config.spikeMaxRun; length += 1) {
      const start = at(position);
      const end = at(position + length - 1);
      const after = at(position + length);
      if (start === undefined || end === undefined || after === undefined) break;
      if (
        speedBetween(before, start) > limit &&
        speedBetween(end, after) > limit &&
        speedBetween(before, after) <= limit
      ) {
        run = length;
        break;
      }
    }
    if (run > 0) {
      for (let offset = 0; offset < run; offset += 1) spikes.add(position + offset);
      previous = position + run;
      position = previous + 1;
      continue;
    }
    previous = position;
    position += 1;
  }
  // The last point: a spike when it disagrees with the two before it, which agree.
  const lastPosition = candidates.length - 1;
  const last = at(lastPosition);
  const beforeLast = at(lastPosition - 1);
  const twoBefore = at(lastPosition - 2);
  if (
    last !== undefined &&
    beforeLast !== undefined &&
    twoBefore !== undefined &&
    !spikes.has(lastPosition) &&
    !spikes.has(lastPosition - 1) &&
    speedBetween(beforeLast, last) > limit &&
    speedBetween(twoBefore, beforeLast) <= limit
  ) {
    spikes.add(lastPosition);
  }
  return spikes;
}

/**
 * The averaged level (docs/architecture.md §17.3): per device, in time order.
 *
 * 1. Points less accurate than `maxAccuracyM` are dropped, and so are spikes.
 * 2. Consecutive points within max(accuracy, 25 m) of the running centroid at
 *    walking-pace-or-less (0.5 m/s) form a stationary cluster and collapse to
 *    its accuracy-weighted centroid: a phone on a table draws a dot, not a star.
 * 3. A moving point becomes the 1/accuracy²-weighted mean of itself and its
 *    moving neighbours within ±20 s — at most three on each side, and only
 *    those within two accuracies of it, so noise is smoothed where it matters
 *    (slow, inaccurate) and corners at speed survive. Sparse points have no
 *    neighbours that close and are left as they are.
 * 4. The speed is the median of the reported and the derived speeds.
 *
 * Returns one entry per input point, in input order.
 */
export function averagePoints(
  points: readonly RawPoint[],
  config: AveragingConfig,
): AveragedPoint[] {
  const accuracyOf = (point: RawPoint): number => point.accuracy ?? config.defaultAccuracyM;
  const weightOf = (accuracy: number): number =>
    1 / Math.max(accuracy, config.minWeightAccuracyM) ** 2;

  const accurate: number[] = [];
  for (const [index, point] of points.entries()) {
    if (point.accuracy === null || point.accuracy <= config.maxAccuracyM) accurate.push(index);
  }
  const spikePositions = findSpikes(points, accurate, config);
  const keptIndices = accurate.filter((_, position) => !spikePositions.has(position));

  const result: AveragedPoint[] = points.map((point) => ({
    t: point.t,
    kept: false,
    lat: point.lat,
    lon: point.lon,
    speed: point.speed ?? 0,
    stationary: false,
    accuracy: accuracyOf(point),
  }));

  // Stationary clusters, over the kept points in order.
  const stationary = new Set<number>();
  let cluster: number[] = [];
  let weightSum = 0;
  let latSum = 0;
  let lonSum = 0;
  const closeCluster = () => {
    if (cluster.length >= 2) {
      const lat = latSum / weightSum;
      const lon = lonSum / weightSum;
      for (const index of cluster) {
        stationary.add(index);
        const entry = result[index];
        if (entry !== undefined) {
          entry.lat = lat;
          entry.lon = lon;
        }
      }
    }
    cluster = [];
    weightSum = 0;
    latSum = 0;
    lonSum = 0;
  };
  const addToCluster = (index: number, point: RawPoint) => {
    const weight = weightOf(accuracyOf(point));
    cluster.push(index);
    weightSum += weight;
    latSum += weight * point.lat;
    lonSum += weight * point.lon;
  };
  let previous: RawPoint | undefined;
  for (const index of keptIndices) {
    const point = points[index];
    if (point === undefined) continue;
    const derived =
      previous === undefined
        ? 0
        : Math.max(
            0,
            haversineM(previous, point) - (accuracyOf(previous) + accuracyOf(point)) / 2,
          ) / Math.max(1, point.t - previous.t);
    const speed = point.speed ?? derived;
    const slow = speed <= config.clusterSpeedMs;
    if (cluster.length > 0) {
      const centroid = { lat: latSum / weightSum, lon: lonSum / weightSum };
      const radius = Math.max(accuracyOf(point), config.clusterRadiusM);
      if (slow && haversineM(centroid, point) <= radius) {
        addToCluster(index, point);
        previous = point;
        continue;
      }
      closeCluster();
    }
    if (slow) addToCluster(index, point);
    previous = point;
  }
  closeCluster();

  // Moving points: a weighted mean over close neighbours that are moving too.
  for (const [position, index] of keptIndices.entries()) {
    const point = points[index];
    const entry = result[index];
    if (point === undefined || entry === undefined) continue;
    entry.kept = true;
    entry.stationary = stationary.has(index);
    if (entry.stationary) continue;
    const radius = Math.max(
      config.minNeighbourRadiusM,
      config.neighbourAccuracies * accuracyOf(point),
    );
    let weightTotal = weightOf(accuracyOf(point));
    let latTotal = weightTotal * point.lat;
    let lonTotal = weightTotal * point.lon;
    let neighbours = 0;
    for (const direction of [-1, 1]) {
      for (let step = 1; step <= config.maxNeighbours; step += 1) {
        const neighbourIndex = keptIndices[position + direction * step];
        if (neighbourIndex === undefined || stationary.has(neighbourIndex)) break;
        const neighbour = points[neighbourIndex];
        if (neighbour === undefined) break;
        if (Math.abs(neighbour.t - point.t) > config.windowS) break;
        if (haversineM(neighbour, point) > radius) break;
        const weight = weightOf(accuracyOf(neighbour));
        weightTotal += weight;
        latTotal += weight * neighbour.lat;
        lonTotal += weight * neighbour.lon;
        neighbours += 1;
      }
    }
    // Without neighbours the point stays exactly where it was.
    if (neighbours > 0) {
      entry.lat = latTotal / weightTotal;
      entry.lon = lonTotal / weightTotal;
    }
  }

  // Speeds: the median of the reported speed and the speeds to the neighbouring kept points.
  for (const [position, index] of keptIndices.entries()) {
    const entry = result[index];
    const point = points[index];
    if (entry === undefined || point === undefined) continue;
    const speeds: number[] = [];
    if (point.speed !== null) speeds.push(point.speed);
    for (const neighbourPosition of [position - 1, position + 1]) {
      const neighbourIndex = keptIndices[neighbourPosition];
      const neighbour = neighbourIndex === undefined ? undefined : result[neighbourIndex];
      if (neighbour === undefined) continue;
      speeds.push(haversineM(neighbour, entry) / Math.max(1, Math.abs(neighbour.t - entry.t)));
    }
    entry.speed = median(speeds);
  }
  return result;
}
