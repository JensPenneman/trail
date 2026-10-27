import type { KeptPoint } from "../../src/processing/keptPoint";
import type { Span } from "../../src/processing/pipelineTypes";
import type { ProcessingConfig } from "../../src/processing/processingConfig";
import { haversineM } from "../../src/tracks/haversine";

/*
 * What every cut of a day into stops and moves must satisfy, checked from the
 * outside (docs/architecture.md §17.3): stops hold no travel, segments do not
 * overlap, and every kept point lies in one.
 */

type StopsConfig = ProcessingConfig["stops"];

/** The accuracy-weighted middle of points `first..last` (as the pipeline weighs them). */
function middleOf(points: readonly KeptPoint[], first: number, last: number) {
  let weights = 0;
  let lat = 0;
  let lon = 0;
  for (let index = first; index <= last; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    const weight = 1 / Math.max(point.accuracy, 5) ** 2;
    weights += weight;
    lat += weight * point.lat;
    lon += weight * point.lon;
  }
  return { lat: lat / weights, lon: lon / weights };
}

export interface TravelInStop {
  stop: { startT: number; endT: number };
  /** The run of points out there: when it began, how long it lasted, how far out it went. */
  fromT: number;
  seconds: number;
  farthestM: number;
}

/**
 * Stops holding travel: a run of `travelMinS` (two minutes) or more of points
 * farther than `pauseRadiusM` from the stop's centroid.
 */
export function stopsHoldingTravel(
  points: readonly KeptPoint[],
  spans: readonly Span[],
  config: StopsConfig,
): TravelInStop[] {
  const found: TravelInStop[] = [];
  for (const span of spans) {
    if (span.kind !== "stop") continue;
    const centre = middleOf(points, span.first, span.last);
    let run: { from: KeptPoint; to: KeptPoint; farthestM: number } | null = null;
    const close = () => {
      if (run !== null && run.to.t - run.from.t >= config.travelMinS) {
        found.push({
          stop: { startT: span.startT, endT: span.endT },
          fromT: run.from.t,
          seconds: run.to.t - run.from.t,
          farthestM: Math.round(run.farthestM),
        });
      }
      run = null;
    };
    for (let index = span.first; index <= span.last; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      const distance = haversineM(centre, point);
      if (distance > config.pauseRadiusM) {
        if (run === null) run = { from: point, to: point, farthestM: distance };
        else {
          run.to = point;
          run.farthestM = Math.max(run.farthestM, distance);
        }
      } else {
        close();
      }
    }
    close();
  }
  return found;
}

/** Neighbouring spans that overlap (sharing a boundary point and instant is how they meet). */
export function overlaps(spans: readonly Span[]): [Span, Span][] {
  const found: [Span, Span][] = [];
  for (let index = 1; index < spans.length; index += 1) {
    const before = spans[index - 1];
    const span = spans[index];
    if (before === undefined || span === undefined) continue;
    if (
      span.startT < before.endT ||
      span.first < before.last ||
      span.endT < span.startT ||
      span.last < span.first
    ) {
      found.push([before, span]);
    }
  }
  return found;
}

/** Whether the interval before point `index` is a recording gap without travel fast enough to bridge it. */
function gapBefore(points: readonly KeptPoint[], index: number, config: StopsConfig): boolean {
  const before = points[index - 1];
  const after = points[index];
  if (before === undefined || after === undefined) return true;
  const seconds = after.t - before.t;
  return seconds > config.gapSplitS && haversineM(before, after) / seconds < config.gapKeepSpeedMs;
}

/**
 * Kept points in no span. A point alone between two recording gaps (or a gap
 * and the edge of the window) cannot make a move, and is left out of this.
 */
export function uncoveredPoints(
  points: readonly KeptPoint[],
  spans: readonly Span[],
  config: StopsConfig,
): number[] {
  const covered = new Uint8Array(points.length);
  for (const span of spans)
    for (let index = span.first; index <= span.last; index += 1) covered[index] = 1;
  const missing: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (covered[index] === 1) continue;
    const alone = gapBefore(points, index, config) && gapBefore(points, index + 1, config);
    if (!alone) missing.push(index);
  }
  return missing;
}

/** Seconds of `[from, to]` covered by spans of `kind`. */
export function secondsCovered(
  spans: readonly Span[],
  kind: Span["kind"],
  from: number,
  to: number,
): number {
  let seconds = 0;
  for (const span of spans) {
    if (span.kind !== kind) continue;
    seconds += Math.max(0, Math.min(to, span.endT) - Math.max(from, span.startT));
  }
  return seconds;
}
