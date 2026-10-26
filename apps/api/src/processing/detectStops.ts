import { haversineM } from "../tracks/haversine";
import type { KeptPoint } from "./keptPoint";
import { motionActivity } from "./motionActivity";
import type { Span, VisitSpan } from "./pipelineTypes";
import type { ProcessingConfig } from "./processingConfig";

type StopsConfig = ProcessingConfig["stops"];

interface StopRange {
  first: number;
  last: number;
}

/** Accuracy-weighted centroid of kept points `first..last`. */
export function centroidOf(
  points: readonly KeptPoint[],
  first: number,
  last: number,
): { lat: number; lon: number } {
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
  return weights === 0 ? { lat: 0, lon: 0 } : { lat: lat / weights, lon: lon / weights };
}

/** Faster than this, a point at the edge of a stay is arriving or leaving (m/s). */
const stillSpeedMs = 0.5;

/** At least `minDurationS` within `radiusM` of the running centroid (greedy, oldest first). */
function dwellStops(points: readonly KeptPoint[], config: StopsConfig): StopRange[] {
  const stops: StopRange[] = [];
  let start = 0;
  while (start < points.length) {
    const anchor = points[start];
    if (anchor === undefined) break;
    let weights = 1 / Math.max(anchor.accuracy, 5) ** 2;
    let lat = weights * anchor.lat;
    let lon = weights * anchor.lon;
    let end = start;
    for (;;) {
      const next = points[end + 1];
      if (next === undefined) break;
      if (haversineM({ lat: lat / weights, lon: lon / weights }, next) > config.radiusM) break;
      const weight = 1 / Math.max(next.accuracy, 5) ** 2;
      weights += weight;
      lat += weight * next.lat;
      lon += weight * next.lon;
      end += 1;
    }
    // Arriving and leaving are not part of the stay: trim moving points at both ends.
    const moving = (index: number) => (points[index]?.speed ?? 0) > stillSpeedMs;
    let first = start;
    let last = end;
    while (first < last && moving(first)) first += 1;
    while (last > first && moving(last)) last -= 1;
    const firstPoint = points[first];
    const lastPoint = points[last];
    if (
      firstPoint !== undefined &&
      lastPoint !== undefined &&
      last > first &&
      lastPoint.t - firstPoint.t >= config.minDurationS
    ) {
      stops.push({ first, last });
      start = end + 1;
    } else {
      start += 1;
    }
  }
  return stops;
}

/** iOS visits: the points of a visit's time near its place. */
function visitStops(
  points: readonly KeptPoint[],
  visits: readonly VisitSpan[],
  config: StopsConfig,
): StopRange[] {
  const stops: StopRange[] = [];
  const lastT = points.at(-1)?.t ?? 0;
  for (const visit of visits) {
    const until = visit.departedAt ?? lastT;
    if (until < visit.arrivedAt) continue;
    const radius = Math.max(config.visitRadiusM, visit.accuracy ?? 0);
    let first = -1;
    let last = -1;
    let inside = 0;
    let total = 0;
    for (const [index, point] of points.entries()) {
      if (point.t < visit.arrivedAt || point.t > until) continue;
      total += 1;
      if (haversineM(visit, point) > radius) continue;
      inside += 1;
      if (first < 0) first = index;
      last = index;
    }
    // A visit the points disagree with (iOS reports one now and then mid-journey) is ignored.
    if (first >= 0 && last > first && inside * 2 >= total) stops.push({ first, last });
  }
  return stops;
}

/** CoreMotion said stationary, and nothing else, for long enough (indoors, where GPS drifts). */
function motionStops(points: readonly KeptPoint[], config: StopsConfig): StopRange[] {
  const stops: StopRange[] = [];
  let start = -1;
  const close = (end: number) => {
    const first = points[start];
    const last = points[end];
    if (start >= 0 && first !== undefined && last !== undefined && end > start) {
      const centre = centroidOf(points, start, end);
      let spread = 0;
      for (let index = start; index <= end; index += 1) {
        const point = points[index];
        if (point !== undefined) spread = Math.max(spread, haversineM(centre, point));
      }
      if (last.t - first.t >= config.minDurationS && spread <= config.pauseRadiusM) {
        stops.push({ first: start, last: end });
      }
    }
    start = -1;
  };
  for (const [index, point] of points.entries()) {
    if (motionActivity(point.motion) === "stationary") {
      if (start < 0) start = index;
    } else if (start >= 0) {
      close(index - 1);
    }
  }
  if (start >= 0) close(points.length - 1);
  return stops;
}

/** Overlapping or adjacent ranges become one. */
function union(ranges: StopRange[]): StopRange[] {
  const sorted = [...ranges].sort((a, b) => a.first - b.first || a.last - b.last);
  const merged: StopRange[] = [];
  for (const range of sorted) {
    const current = merged.at(-1);
    if (current !== undefined && range.first <= current.last + 1) {
      current.last = Math.max(current.last, range.last);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Neighbouring stops that are one stay: the same place on both sides of a
 * recording pause, or two stops close together with only a short wander
 * between them (GPS drifting indoors breaks a stay in two).
 */
function joinStays(
  points: readonly KeptPoint[],
  stops: StopRange[],
  config: StopsConfig,
): StopRange[] {
  const joined: StopRange[] = [];
  for (const stop of stops) {
    const previous = joined.at(-1);
    if (previous !== undefined) {
      const left = centroidOf(points, previous.first, previous.last);
      const right = centroidOf(points, stop.first, stop.last);
      const apart = haversineM(left, right);
      const leftEnd = points[previous.last];
      const rightStart = points[stop.first];
      const between =
        leftEnd !== undefined && rightStart !== undefined ? rightStart.t - leftEnd.t : 0;
      const pause = stop.first === previous.last + 1 && between >= config.pauseGapS;
      let wander = 0;
      for (let index = previous.last + 1; index < stop.first; index += 1) {
        const point = points[index];
        if (point !== undefined) wander = Math.max(wander, haversineM(left, point));
      }
      const shortWander =
        apart <= config.mergeRadiusM &&
        between <= config.mergeMoveMaxS &&
        wander <= 2 * config.radiusM;
      if ((pause && apart <= config.pauseRadiusM) || shortWander) {
        previous.last = stop.last;
        continue;
      }
    }
    joined.push({ ...stop });
  }
  return joined;
}

/** Whether the interval before `next` is a recording gap the device did not travel through. */
function isGap(points: readonly KeptPoint[], next: number, config: StopsConfig): boolean {
  const before = points[next - 1];
  const after = points[next];
  if (before === undefined || after === undefined) return false;
  const seconds = after.t - before.t;
  if (seconds <= config.gapSplitS) return false;
  return haversineM(before, after) / seconds < config.gapKeepSpeedMs;
}

/** Splits `first..last` at recording gaps into moves of at least two points. */
function movesBetween(
  points: readonly KeptPoint[],
  first: number,
  last: number,
  config: StopsConfig,
): Span[] {
  const moves: Span[] = [];
  let start = first;
  const push = (end: number) => {
    const a = points[start];
    const b = points[end];
    if (a !== undefined && b !== undefined && end > start) {
      moves.push({ kind: "move", first: start, last: end, startT: a.t, endT: b.t });
    }
  };
  for (let index = first + 1; index <= last; index += 1) {
    if (isGap(points, index, config)) {
      push(index - 1);
      start = index;
    }
  }
  push(last);
  return moves;
}

/**
 * Cuts a window's kept points into stops and moves (docs/architecture.md §17.3,
 * inferred, step 1). A stop is at least `minDurationS` within `radiusM` of its
 * centroid, the points of an iOS visit near its place, or CoreMotion reporting
 * stationary throughout; stops at one place on both sides of a pause, or close
 * together with only a short wander between them, are one stop. Moves fill the
 * time between stops and share their end points with them, so the line of a
 * move starts where the stop before it ends. After a recording pause the stop
 * lasts until the first point outside it (iOS resumes outside its geofence).
 * A recording gap without travel ends a move: the time between belongs to no
 * segment.
 */
export function detectStops(
  points: readonly KeptPoint[],
  visits: readonly VisitSpan[],
  config: StopsConfig,
): Span[] {
  if (points.length === 0) return [];
  const stops = joinStays(
    points,
    union([
      ...dwellStops(points, config),
      ...visitStops(points, visits, config),
      ...motionStops(points, config),
    ]),
    config,
  );

  const spans: Span[] = [];
  let moveStart = 0;
  for (const stop of stops) {
    const first = points[stop.first];
    const last = points[stop.last];
    if (first === undefined || last === undefined) continue;
    // The move before this stop ends at its first point (unless a gap came first).
    if (stop.first > moveStart) {
      const end = isGap(points, stop.first, config) ? stop.first - 1 : stop.first;
      spans.push(...movesBetween(points, moveStart, end, config));
    }
    const span: Span = {
      kind: "stop",
      first: stop.first,
      last: stop.last,
      startT: first.t,
      endT: last.t,
    };
    spans.push(span);
    const next = points[stop.last + 1];
    moveStart = stop.last;
    if (next !== undefined) {
      const centre = centroidOf(points, stop.first, stop.last);
      const pause = next.t - last.t >= config.pauseGapS;
      if (pause && haversineM(centre, next) <= config.pauseRadiusM) {
        // Still there until the phone reported from outside the stop.
        span.endT = next.t;
        moveStart = stop.last + 1;
      } else if (isGap(points, stop.last + 1, config)) {
        moveStart = stop.last + 1;
      }
    }
  }
  if (moveStart < points.length - 1) {
    spans.push(...movesBetween(points, moveStart, points.length - 1, config));
  }
  return spans;
}
