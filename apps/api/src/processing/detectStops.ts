import { haversineM } from "../tracks/haversine";
import type { KeptPoint } from "./keptPoint";
import { motionActivity } from "./motionActivity";
import type { Span, VisitSpan } from "./pipelineTypes";
import type { ProcessingConfig } from "./processingConfig";

type StopsConfig = ProcessingConfig["stops"];

interface StopRange {
  first: number;
  last: number;
  /**
   * The stay lasted until then, after its last point: the departure of a visit
   * the phone recorded nothing after (iOS pauses the updates of a phone lying still).
   */
  untilT?: number;
}

/** When a stay ended: its last point, or later when a visit says so. */
const endOf = (points: readonly KeptPoint[], range: StopRange): number =>
  Math.max(points[range.last]?.t ?? 0, range.untilT ?? 0);

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

/** Prefix sums of the accuracy weights and weighted positions: a range's centroid in O(1). */
interface Sums {
  weight: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
}

function prefixSums(points: readonly KeptPoint[]): Sums {
  const sums = {
    weight: new Float64Array(points.length + 1),
    lat: new Float64Array(points.length + 1),
    lon: new Float64Array(points.length + 1),
  };
  for (const [index, point] of points.entries()) {
    const weight = 1 / Math.max(point.accuracy, 5) ** 2;
    sums.weight[index + 1] = (sums.weight[index] ?? 0) + weight;
    sums.lat[index + 1] = (sums.lat[index] ?? 0) + weight * point.lat;
    sums.lon[index + 1] = (sums.lon[index] ?? 0) + weight * point.lon;
  }
  return sums;
}

/** `centroidOf` from the prefix sums. */
function centroidIn(sums: Sums, first: number, last: number): { lat: number; lon: number } {
  const weight = (sums.weight[last + 1] ?? 0) - (sums.weight[first] ?? 0);
  if (weight <= 0) return { lat: 0, lon: 0 };
  return {
    lat: ((sums.lat[last + 1] ?? 0) - (sums.lat[first] ?? 0)) / weight,
    lon: ((sums.lon[last + 1] ?? 0) - (sums.lon[first] ?? 0)) / weight,
  };
}

/** The bounding box of points `first..last` (empty when there are none). */
interface Box {
  south: number;
  north: number;
  west: number;
  east: number;
}

const emptyBox: Box = { south: 90, north: -90, west: 180, east: -180 };

function boxOf(points: readonly KeptPoint[], first: number, last: number): Box {
  const box = { ...emptyBox };
  for (let index = first; index <= last; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    box.south = Math.min(box.south, point.lat);
    box.north = Math.max(box.north, point.lat);
    box.west = Math.min(box.west, point.lon);
    box.east = Math.max(box.east, point.lon);
  }
  return box;
}

const joinBoxes = (a: Box, b: Box): Box => ({
  south: Math.min(a.south, b.south),
  north: Math.max(a.north, b.north),
  west: Math.min(a.west, b.west),
  east: Math.max(a.east, b.east),
});

/**
 * The farthest a point of `box` can lie from `centre`, which lies in it: the
 * farthest corner. Within `pauseRadiusM` of it, no point can be travel.
 */
function reachOf(box: Box, centre: { lat: number; lon: number }): number {
  if (box.south > box.north) return 0;
  let reach = 0;
  for (const lat of [box.south, box.north]) {
    for (const lon of [box.west, box.east])
      reach = Math.max(reach, haversineM(centre, { lat, lon }));
  }
  return reach;
}

/** Faster than this, a point at the edge of a stay is arriving or leaving (m/s). */
const stillSpeedMs = 0.5;

const moving = (points: readonly KeptPoint[], index: number): boolean =>
  (points[index]?.speed ?? 0) > stillSpeedMs;

/**
 * How far apart a stop's points `first..last` lie, in metres: the distance
 * between the point farthest from their centroid and the point farthest from
 * that one (the walk within a station, GPS wandering indoors). Only the points
 * the phone was still at count — not a fix jumping off for a moment, nor one
 * it was already riding at — unless it was still at none. Deterministic, and
 * never more than the largest distance between two of them.
 */
export function spreadOf(points: readonly KeptPoint[], first: number, last: number): number {
  const still: KeptPoint[] = [];
  for (let index = first; index <= last; index += 1) {
    const point = points[index];
    if (point !== undefined && !moving(points, index)) still.push(point);
  }
  const counted = still.length > 0 ? still : points.slice(first, last + 1);
  const farthestFrom = (origin: { lat: number; lon: number }) => {
    let best: KeptPoint | null = null;
    let distance = -1;
    for (const point of counted) {
      const here = haversineM(origin, point);
      if (here > distance) {
        best = point;
        distance = here;
      }
    }
    return { best, distance };
  };
  const { best } = farthestFrom(centroidOf(counted, 0, counted.length - 1));
  return best === null ? 0 : Math.max(0, farthestFrom(best).distance);
}

/** Arriving and leaving are not part of the stay: the range without the moving points at its ends. */
function withoutMovingEnds(points: readonly KeptPoint[], range: StopRange): StopRange {
  let { first, last } = range;
  while (first < last && moving(points, first)) first += 1;
  while (last > first && moving(points, last)) last -= 1;
  return { first, last };
}

/** Whether a range is long enough to be a stop on its own. */
function lasts(points: readonly KeptPoint[], range: StopRange, config: StopsConfig): boolean {
  const first = points[range.first];
  const last = points[range.last];
  return (
    first !== undefined &&
    last !== undefined &&
    range.last > range.first &&
    last.t - first.t >= config.minDurationS
  );
}

const onFoot = (point: KeptPoint): boolean => {
  const activity = motionActivity(point.motion);
  return activity === "walking" || activity === "running";
};

/**
 * Each point's pace for telling a walk, m/s: the phone's own speed reading —
 * or, where it gave none, the averaged speed when CoreMotion says on foot (a
 * fix jumping about indoors has a speed of its own, but the phone reads it as
 * still) — averaged over the points within `walkMinS` / 2 of it, so a
 * reading of 0 now and then does not break a walk.
 */
function walkingPaces(points: readonly KeptPoint[], config: StopsConfig): Float64Array {
  const pace = (point: KeptPoint | undefined): number =>
    point === undefined ? 0 : (point.reportedSpeed ?? (onFoot(point) ? point.speed : 0));
  const half = config.walkMinS / 2;
  const paces = new Float64Array(points.length);
  let low = 0;
  let high = 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const t = points[index]?.t ?? 0;
    while (high < points.length && (points[high]?.t ?? 0) <= t + half) {
      sum += pace(points[high]);
      high += 1;
    }
    while ((points[low]?.t ?? 0) < t - half) {
      sum -= pace(points[low]);
      low += 1;
    }
    paces[index] = sum / Math.max(1, high - low);
  }
  return paces;
}

/** The walks among points `first..last`: `walkMinS` or longer at more than `walkSpeedMs`. */
function walksIn(
  points: readonly KeptPoint[],
  paces: Float64Array,
  first: number,
  last: number,
  config: StopsConfig,
): StopRange[] {
  const walks: StopRange[] = [];
  let start = -1;
  const close = (end: number) => {
    const from = points[start];
    const to = points[end];
    if (from !== undefined && to !== undefined && to.t - from.t >= config.walkMinS) {
      walks.push({ first: start, last: end });
    }
    start = -1;
  };
  for (let index = first; index <= last; index += 1) {
    if ((paces[index] ?? 0) > config.walkSpeedMs) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      close(index - 1);
    }
  }
  if (start >= 0) close(last);
  return walks;
}

/**
 * A stay with a real walk in it is two stays when both last `minDurationS`
 * without it: the walk from the bike shed to the platform is a move, even
 * when both lie within a dwell's radius.
 */
function splitAtWalks(
  points: readonly KeptPoint[],
  paces: Float64Array,
  stay: StopRange,
  config: StopsConfig,
): StopRange[] {
  const parts: StopRange[] = [];
  let from = stay.first;
  for (const walk of walksIn(points, paces, stay.first, stay.last, config)) {
    const before = withoutMovingEnds(points, { first: from, last: walk.first - 1 });
    const after = withoutMovingEnds(points, { first: walk.last + 1, last: stay.last });
    if (lasts(points, before, config) && lasts(points, after, config)) {
      parts.push(before);
      from = after.first;
    }
  }
  parts.push(withoutMovingEnds(points, { first: from, last: stay.last }));
  return parts;
}

/**
 * At least `minDurationS` within `radiusM` of the running centroid (greedy,
 * oldest first), split where a real walk lies in it.
 */
function dwellStops(
  points: readonly KeptPoint[],
  paces: Float64Array,
  config: StopsConfig,
): StopRange[] {
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
    const stay = withoutMovingEnds(points, { first: start, last: end });
    if (lasts(points, stay, config)) {
      stops.push(...splitAtWalks(points, paces, stay, config));
      start = end + 1;
    } else {
      start += 1;
    }
  }
  return stops;
}

/** Index of the first point at or after `t` (points are in time order). */
function firstAtOrAfter(points: readonly KeptPoint[], t: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((points[middle]?.t ?? 0) < t) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * A stay of a visit as a stop: without its moving ends, long enough, and with
 * at least half of its points near the place (iOS reports a visit now and then
 * mid-journey, at a train's halt for instance). Null when it is no stop.
 */
function visitStay(
  points: readonly KeptPoint[],
  visit: VisitSpan,
  radius: number,
  range: StopRange,
  config: StopsConfig,
): StopRange | null {
  const stay = withoutMovingEnds(points, range);
  if (!lasts(points, stay, config)) return null;
  let inside = 0;
  for (let index = stay.first; index <= stay.last; index += 1) {
    const point = points[index];
    if (point !== undefined && haversineM(visit, point) <= radius) inside += 1;
  }
  return inside * 2 >= stay.last - stay.first + 1 ? stay : null;
}

/**
 * iOS visits (docs/architecture.md §17.3): the points near a visit's place
 * (within max(`visitRadiusM`, its accuracy), at most `pauseRadiusM`, so GPS
 * drifting indoors stays one stay) from its arrival on, for as long as the
 * phone stays. An excursion away from the place does not end the stay when
 * it is short — away for at most `mergeMoveMaxS` from its first point to its
 * last, never `travelMinS` on end farther than `pauseRadiusM` (a fix 350 m
 * off now and then is no departure), and, while the departure is not known,
 * without a recording gap longer than `mergeMoveMaxS` that could hide where
 * the phone went — and neither does a recording pause the phone spent there.
 * With a point every five minutes one fix off between two at the place is
 * such an excursion, and under a visit whose departure is known also with a
 * point every ten.
 * A visit whose departure is known gives a stay for every time the phone was
 * there before it, the last one lasting until the departure when nothing was
 * recorded in between; one whose departure is not known (still open, or never
 * reported) only the stay from its arrival on, which ends when the phone
 * leaves — never at the end of the window, at the latest at the next visit's
 * arrival. Moving points at both ends are left out, as for dwells.
 */
function visitStops(
  points: readonly KeptPoint[],
  visits: readonly VisitSpan[],
  config: StopsConfig,
): StopRange[] {
  const stops: StopRange[] = [];
  for (const visit of visits) {
    const until = visit.departedAt ?? visit.endsBy ?? Number.POSITIVE_INFINITY;
    if (until < visit.arrivedAt) continue;
    const open = visit.departedAt === null;
    const radius = Math.min(
      config.pauseRadiusM,
      Math.max(config.visitRadiusM, visit.accuracy ?? 0),
    );
    // The stay in progress: its first point and its last point near the place …
    let first = -1;
    let last = -1;
    // … and the excursion in progress: its first point away, and where its run beyond
    // `pauseRadiusM` began (-1: none).
    let away = -1;
    let far = -1;
    const close = () => {
      if (first >= 0) {
        const stay = visitStay(points, visit, radius, { first, last }, config);
        if (stay !== null) {
          // Nothing recorded between the stay and the departure: the phone was there until then.
          const lastPoint = points[stay.last];
          const next = points[stay.last + 1];
          if (
            visit.departedAt !== null &&
            lastPoint !== undefined &&
            next !== undefined &&
            next.t >= visit.departedAt &&
            visit.departedAt > lastPoint.t
          ) {
            stay.untilT = visit.departedAt;
          }
          stops.push(stay);
        }
      }
      first = -1;
      last = -1;
      away = -1;
      far = -1;
    };
    for (let index = firstAtOrAfter(points, visit.arrivedAt); index < points.length; index += 1) {
      const point = points[index];
      if (point === undefined || point.t > until) break;
      const distance = haversineM(visit, point);
      const near = distance <= radius;
      if (first < 0) {
        if (near) {
          first = index;
          last = index;
        } else if (open && point.t - visit.arrivedAt > config.mergeMoveMaxS) {
          // Elsewhere well after the arrival: this open visit is over (or never was).
          break;
        }
        continue;
      }
      // Nothing recorded for longer than an excursion may last: where the phone went is unknown —
      // unless iOS knows when it left, which vouches for the stay until then.
      const unseen = open && point.t - (points[index - 1]?.t ?? point.t) > config.mergeMoveMaxS;
      if (near) {
        // Back from an excursion that a recording gap hid: the stay ended before it.
        if (away >= 0 && unseen) {
          close();
          if (open) break;
          first = index;
        }
        last = index;
        away = -1;
        far = -1;
        continue;
      }
      if (away < 0) away = index;
      if (distance <= config.pauseRadiusM) far = -1;
      else if (far < 0) far = index;
      const awayS = point.t - (points[away]?.t ?? point.t);
      const farS = far < 0 ? 0 : point.t - (points[far]?.t ?? point.t);
      if (unseen || awayS > config.mergeMoveMaxS || farS >= config.travelMinS) {
        // The phone left.
        close();
        if (open) break;
      }
    }
    close();
  }
  return stops;
}

/**
 * CoreMotion said stationary, and nothing else, for long enough (indoors,
 * where GPS drifts) — at one place: a recording pause after which the phone
 * is farther than `pauseRadiusM` away ends it (it was carried there).
 */
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
    const before = points[index - 1];
    if (
      start >= 0 &&
      before !== undefined &&
      point.t - before.t >= config.pauseGapS &&
      haversineM(before, point) > config.pauseRadiusM
    ) {
      close(index - 1);
    }
    if (motionActivity(point.motion) === "stationary") {
      if (start < 0) start = index;
    } else if (start >= 0) {
      close(index - 1);
    }
  }
  if (start >= 0) close(points.length - 1);
  return stops;
}

/**
 * Recording gaps the phone lay still through: longer than `gapSplitS`, with
 * their two ends within `pauseRadiusM` of each other. Each is a stop of the
 * point before it that lasts until the point after it, so the time is
 * covered; that point is where the phone woke up — 150 m on and riding, it
 * starts the move. A gap with travel belongs to no segment.
 */
function gapStops(points: readonly KeptPoint[], config: StopsConfig): StopRange[] {
  const stops: StopRange[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (before === undefined || after === undefined) continue;
    if (after.t - before.t > config.gapSplitS && haversineM(before, after) <= config.pauseRadiusM) {
      stops.push({ first: index - 1, last: index - 1, untilT: after.t });
    }
  }
  return stops;
}

/**
 * Overlapping ranges become one, and so do adjacent ones — unless the phone
 * jumped farther than `pauseRadiusM` between them: two places, which
 * `joinStays` may still find to be one stay.
 */
function union(
  points: readonly KeptPoint[],
  ranges: StopRange[],
  config: StopsConfig,
): StopRange[] {
  const sorted = [...ranges].sort((a, b) => a.first - b.first || a.last - b.last);
  const merged: StopRange[] = [];
  for (const range of sorted) {
    const current = merged.at(-1);
    const end = current === undefined ? undefined : points[current.last];
    const start = points[range.first];
    const adjacent =
      current !== undefined &&
      range.first === current.last + 1 &&
      end !== undefined &&
      start !== undefined &&
      haversineM(end, start) <= config.pauseRadiusM;
    if (current !== undefined && (range.first <= current.last || adjacent)) {
      const until = Math.max(endOf(points, current), endOf(points, range));
      current.last = Math.max(current.last, range.last);
      if (until > (points[current.last]?.t ?? 0)) current.untilT = until;
      else delete current.untilT;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * The runs of points `first..last` that are travel, not a stay: `travelMinS`
 * or longer farther than `pauseRadiusM` from the centroid of them all.
 */
function travelRuns(
  points: readonly KeptPoint[],
  sums: Sums,
  first: number,
  last: number,
  config: StopsConfig,
): StopRange[] {
  const centre = centroidIn(sums, first, last);
  if (reachOf(boxOf(points, first, last), centre) <= config.pauseRadiusM) return [];
  const runs: StopRange[] = [];
  let start = -1;
  const close = (end: number) => {
    const from = points[start];
    const to = points[end];
    if (from !== undefined && to !== undefined && to.t - from.t >= config.travelMinS) {
      runs.push({ first: start, last: end });
    }
    start = -1;
  };
  for (let index = first; index <= last; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    if (haversineM(centre, point) > config.pauseRadiusM) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      close(index - 1);
    }
  }
  if (start >= 0) close(last);
  return runs;
}

/**
 * Whether the points between two stays (after `from`, before `to`) are a real
 * walk: `walkMinS` or longer at walking pace, or CoreMotion on foot
 * throughout. The walk from the bike shed to the platform is a move between
 * two stops; GPS drifting indoors is not.
 */
function walkedBetween(
  points: readonly KeptPoint[],
  paces: Float64Array,
  from: number,
  to: number,
  config: StopsConfig,
): boolean {
  if (to - from < 2) return false;
  if (walksIn(points, paces, from + 1, to - 1, config).length > 0) return true;
  // The readings on foot must last a walk themselves: one "walking" reading as the fix jumps,
  // with a point every minute, is none.
  if ((points[to - 1]?.t ?? 0) - (points[from + 1]?.t ?? 0) < config.walkMinS) return false;
  for (let index = from + 1; index < to; index += 1) {
    const point = points[index];
    if (point !== undefined && !onFoot(point)) return false;
  }
  return true;
}

/**
 * Whether two neighbouring stops are one stay: the same place on both sides of
 * a recording pause, or two stops close together with only a short wander
 * between them (GPS drifting indoors breaks a stay in two): seen away for at
 * most `mergeMoveMaxS`, from the first point after the one stop to the last
 * before the other, with no recording gap that long in it — not a real walk —
 * and joined they must not hold travel (a short stay hundreds of metres from a
 * long one is another place). `joined` is the box of both and what lies
 * between: when the joined stay's centroid is within `pauseRadiusM` of all of
 * it, nothing in it can be travel, and the points need not be looked at again.
 */
function oneStay(
  points: readonly KeptPoint[],
  paces: Float64Array,
  sums: Sums,
  previous: StopRange,
  stop: StopRange,
  joined: Box,
  config: StopsConfig,
): boolean {
  const left = centroidIn(sums, previous.first, previous.last);
  const right = centroidIn(sums, stop.first, stop.last);
  const apart = haversineM(left, right);
  const leftEnd = points[previous.last];
  const rightStart = points[stop.first];
  const between = leftEnd !== undefined && rightStart !== undefined ? rightStart.t - leftEnd.t : 0;
  const pause = stop.first === previous.last + 1 && between >= config.pauseGapS;
  // How long the phone was seen away between them — with a point every three minutes, one fix
  // off is no excursion of six — how far, and whether a recording gap could hide more: one fix
  // within `pauseRadiusM` between two at the place hides nothing (GPS jumping about indoors).
  let wander = 0;
  let unseen = false;
  for (let index = previous.last + 1; index <= stop.first; index += 1) {
    const point = points[index];
    const before = points[index - 1];
    if (point === undefined || before === undefined) continue;
    if (point.t - before.t > config.mergeMoveMaxS) unseen = true;
    if (index < stop.first) wander = Math.max(wander, haversineM(left, point));
  }
  const firstAway = points[previous.last + 1];
  const lastAway = points[stop.first - 1];
  const awayS =
    stop.first > previous.last + 1 && firstAway !== undefined && lastAway !== undefined
      ? lastAway.t - firstAway.t
      : 0;
  const single = stop.first === previous.last + 2;
  const hidden = unseen && !(single && wander <= config.pauseRadiusM);
  // One fix may jump however far (GPS indoors); an excursion of more than one, only within
  // `pauseRadiusM`: without speed readings, a ride to a shop 400 m away is no wander.
  const shortWander =
    apart <= config.mergeRadiusM &&
    awayS <= config.mergeMoveMaxS &&
    (single || wander <= config.pauseRadiusM) &&
    !hidden &&
    !walkedBetween(points, paces, previous.last, stop.first, config);
  if (!((pause && apart <= config.pauseRadiusM) || shortWander)) return false;
  const centre = centroidIn(sums, previous.first, stop.last);
  if (reachOf(joined, centre) <= config.pauseRadiusM) return true;
  return travelRuns(points, sums, previous.first, stop.last, config).length === 0;
}

/** Neighbouring stops that are one stay become one (`oneStay`). */
function joinStays(
  points: readonly KeptPoint[],
  paces: Float64Array,
  sums: Sums,
  stops: StopRange[],
  config: StopsConfig,
): StopRange[] {
  const joined: StopRange[] = [];
  // The box of the last joined stop, kept as it grows: a long chain of joins stays linear.
  let box = emptyBox;
  for (const stop of stops) {
    const own = boxOf(points, stop.first, stop.last);
    const previous = joined.at(-1);
    if (previous !== undefined) {
      const both = joinBoxes(joinBoxes(box, own), boxOf(points, previous.last + 1, stop.first - 1));
      if (oneStay(points, paces, sums, previous, stop, both, config)) {
        previous.last = stop.last;
        if (stop.untilT === undefined) delete previous.untilT;
        else previous.untilT = stop.untilT;
        box = both;
        continue;
      }
    }
    joined.push({ ...stop });
    box = own;
  }
  return joined;
}

/**
 * A stop never holds travel: where `travelMinS` or more of its points lie
 * farther than `pauseRadiusM` from its centroid, it is cut, and those points
 * go to the move between its parts — except the stays among them: a stop found
 * there on its own (a dwell 400 m away that a visit's wide radius took in)
 * stays a stop. A part that no longer lasts `minDurationS` is no stop; the
 * others are checked again on their own.
 */
function withoutTravel(
  points: readonly KeptPoint[],
  sums: Sums,
  candidates: readonly StopRange[],
  stop: StopRange,
  config: StopsConfig,
): StopRange[] {
  const runs = travelRuns(points, sums, stop.first, stop.last, config);
  if (runs.length === 0) return [stop];
  const parts: StopRange[] = [];
  let from = stop.first;
  for (const run of runs) {
    parts.push({ first: from, last: run.first - 1 });
    // Smaller than the stop, so the cutting ends.
    const within = candidates.filter(
      (candidate) =>
        candidate.first >= run.first &&
        candidate.last <= run.last &&
        candidate.last - candidate.first < stop.last - stop.first,
    );
    parts.push(...union(points, within, config));
    from = run.last + 1;
  }
  parts.push({ first: from, last: stop.last });
  return parts
    .map((part): StopRange => {
      const trimmed = withoutMovingEnds(points, part);
      // A stay that lasted until a visit's departure keeps it while it keeps its last point.
      const until =
        trimmed.last === stop.last
          ? stop.untilT
          : trimmed.last === part.last
            ? part.untilT
            : undefined;
      return until === undefined ? trimmed : { ...trimmed, untilT: until };
    })
    .filter((part) => lasts(points, part, config))
    .flatMap((part) => withoutTravel(points, sums, candidates, part, config));
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
 * centroid, the points of an iOS visit near its place for as long as the
 * phone stays, CoreMotion reporting stationary throughout, or a recording gap
 * the phone lay still through; stops at one place on both sides of a pause,
 * or close together with only a short wander (no real walk) between them, are
 * one stop, and no stop holds travel. Moves fill the time between stops and
 * share their end points with them, so the line of a move starts where the
 * stop before it ends — except after a stop that lasted beyond its last
 * point: after a recording pause the stop lasts until the first point outside
 * it (iOS resumes outside its geofence), after a still recording gap until
 * the phone woke up, under a visit until its departure, and the move starts
 * at the point after it. A recording gap with travel ends a move: the time
 * between belongs to no segment.
 */
export function detectStops(
  points: readonly KeptPoint[],
  visits: readonly VisitSpan[],
  config: StopsConfig,
): Span[] {
  if (points.length === 0) return [];
  const paces = walkingPaces(points, config);
  const sums = prefixSums(points);
  const candidates = [
    ...dwellStops(points, paces, config),
    ...visitStops(points, visits, config),
    ...motionStops(points, config),
    ...gapStops(points, config),
  ];
  const stops = joinStays(points, paces, sums, union(points, candidates, config), config).flatMap(
    (stop) => withoutTravel(points, sums, candidates, stop, config),
  );

  const spans: Span[] = [];
  let moveStart = 0;
  for (const [position, stop] of stops.entries()) {
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
      endT: endOf(points, stop),
    };
    spans.push(span);
    const next = points[stop.last + 1];
    moveStart = stop.last;
    if (next !== undefined) {
      const centre = centroidIn(sums, stop.first, stop.last);
      const near = haversineM(centre, next) <= config.pauseRadiusM;
      const pause = next.t - last.t >= config.pauseGapS;
      const extended = span.endT > last.t || (pause && near);
      if (pause && near) {
        // Still there until the phone reported from outside the stop.
        span.endT = next.t;
      }
      if (extended || isGap(points, stop.last + 1, config)) {
        // There until it left (a visit's departure, a pause), or a gap with travel: the move
        // starts after it.
        moveStart = stop.last + 1;
      }
      // A point alone after the stop's end — the window's last, or a gap with travel after it,
      // and no stop starting there — can start no move: near the stop, it is the stop's.
      const alone = stop.last + 2 >= points.length || isGap(points, stop.last + 2, config);
      if (extended && near && alone && stops[position + 1]?.first !== stop.last + 1) {
        span.last = stop.last + 1;
        span.ownLast = stop.last;
        span.endT = Math.max(span.endT, next.t);
      }
    }
  }
  if (moveStart < points.length - 1) {
    spans.push(...movesBetween(points, moveStart, points.length - 1, config));
  }
  return spans;
}
