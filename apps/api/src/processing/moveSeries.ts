import { haversineM } from "../tracks/haversine";
import type { KeptPoint } from "./keptPoint";
import type { PoiKind } from "./mapData";
import { type MotionActivity, motionActivity } from "./motionActivity";
import type { MappedPoint, StopCounts, WayShares } from "./pipelineTypes";
import type { PoiLookup } from "./poiIndex";
import type { ProcessingConfig } from "./processingConfig";
import { wayFamilyOf } from "./wayFamily";
import { kindBits, type WayIndex } from "./wayIndex";

type FeaturesConfig = ProcessingConfig["features"];

/**
 * What the ways near a move say, per point and per interval (interval `k` runs
 * from point `k - 1` to point `k`). Sampled stretch by stretch while each
 * piece's map data is loaded (`sampleWays`), so the way index can go before
 * the move is judged.
 */
export interface WaySamples {
  /** Per point: near tram tracks, a cycleway, a footway. */
  nearTram: Uint8Array;
  nearCycleway: Uint8Array;
  nearFoot: Uint8Array;
  /** Corridor samples per interval: how many, and how many near a railway / motorway. */
  corridorSamples: Int32Array;
  corridorRail: Int32Array;
  corridorMotorway: Int32Array;
}

/** What the map adds to a move: present only when the move's area is loaded. */
export interface MoveMap {
  ways: WaySamples;
  pois: PoiLookup;
}

export const emptyWaySamples = (count: number): WaySamples => ({
  nearTram: new Uint8Array(count),
  nearCycleway: new Uint8Array(count),
  nearFoot: new Uint8Array(count),
  corridorSamples: new Int32Array(count),
  corridorRail: new Int32Array(count),
  corridorMotorway: new Int32Array(count),
});

/** A pause inside a move. */
interface Dwell {
  /** Positions in the move (inclusive). */
  first: number;
  last: number;
  near: StopCounts;
}

/**
 * Per-interval values of one move, computed once: features of the whole move
 * and of the splitting stage's sliding windows add them up over a range.
 * Interval `k` runs from point `k - 1` to point `k` (k ≥ 1).
 */
export interface MoveSeries {
  points: readonly KeptPoint[];
  mapped: boolean;
  dt: Float64Array;
  distance: Float64Array;
  speed: Float64Array;
  /** Distance shares by way family per interval (half from each end point). */
  families: readonly (Partial<WayShares> | null)[];
  /** Per point: near tram tracks, a cycleway, a footway. */
  nearTram: Uint8Array;
  nearCycleway: Uint8Array;
  nearFoot: Uint8Array;
  activity: readonly (MotionActivity | null)[];
  /** Corridor samples per interval: how many, and how many near a railway / motorway. */
  corridorSamples: Int32Array;
  corridorRail: Int32Array;
  corridorMotorway: Int32Array;
  dwells: readonly Dwell[];
  /** Per point: the bus stop and the tram stop it passes, if any. */
  busStopPassed: readonly (string | null)[];
  tramStopPassed: readonly (string | null)[];
  /** Public transport stops near a point of the move; null without map data. */
  stopsAt: (position: number) => StopCounts | null;
}

const poiGroups: readonly [
  keyof StopCounts,
  readonly PoiKind[],
  keyof FeaturesConfig["poiRadiusM"],
][] = [
  ["station", ["station", "halt"], "station"],
  ["tramStop", ["tram_stop"], "tramStop"],
  ["subway", ["subway_station"], "subway"],
  ["busStop", ["bus_stop"], "busStop"],
  ["ferry", ["ferry_terminal"], "ferry"],
  ["aerodrome", ["aerodrome"], "aerodrome"],
];

export const zeroCounts = (): StopCounts => ({
  station: 0,
  tramStop: 0,
  subway: 0,
  busStop: 0,
  ferry: 0,
  aerodrome: 0,
});

function stopsNear(
  position: { lat: number; lon: number },
  pois: PoiLookup,
  config: FeaturesConfig,
): StopCounts {
  const counts = zeroCounts();
  for (const [key, kinds, radius] of poiGroups) {
    if (pois.nearest(position, kinds, config.poiRadiusM[radius]) !== null) counts[key] = 1;
  }
  return counts;
}

const railBits = kindBits.rail | kindBits.light_rail;
const motorwayBits = kindBits.motorway | kindBits.trunk;
const tramBits = kindBits.tram | kindBits.light_rail;
const cyclewayBits = kindBits.cycleway;
const footBits = kindBits.footway | kindBits.path;

/**
 * The way samples of points `first..last` of a move and of the intervals into
 * them (the one into `first` too, when there is a point before): near which
 * kinds of ways each point lies, and what lies along the straight lines
 * between points — a sample every `corridorStepM`, counted from the move's
 * start, so stretches add up to the whole. Index 0 is position `first`.
 */
export function sampleWays(
  points: readonly KeptPoint[],
  range: { first: number; last: number },
  index: WayIndex,
  config: FeaturesConfig,
): WaySamples {
  const { first, last } = range;
  const samples = emptyWaySamples(last - first + 1);
  const { projection } = index;
  for (let position = first; position <= last; position += 1) {
    const point = points[position];
    if (point === undefined) continue;
    const radius = Math.min(config.nearMaxM, Math.max(config.nearMinM, 1.5 * point.accuracy));
    const near = index.kindsNear(projection.x(point.lon), projection.y(point.lat), radius);
    const at = position - first;
    samples.nearTram[at] = (near & tramBits) === 0 ? 0 : 1;
    samples.nearCycleway[at] = (near & cyclewayBits) === 0 ? 0 : 1;
    samples.nearFoot[at] = (near & footBits) === 0 ? 0 : 1;
  }

  const step = config.corridorStepM;
  let along = 0;
  for (let k = 1; k < first; k += 1) {
    const from = points[k - 1];
    const to = points[k];
    if (from !== undefined && to !== undefined) along += haversineM(from, to);
  }
  for (let k = Math.max(1, first); k <= last; k += 1) {
    const from = points[k - 1];
    const to = points[k];
    if (from === undefined || to === undefined) continue;
    const chord = haversineM(from, to);
    const ax = projection.x(from.lon);
    const ay = projection.y(from.lat);
    const bx = projection.x(to.lon);
    const by = projection.y(to.lat);
    const at = k - first;
    for (let sample = Math.ceil(along / step) * step; sample < along + chord; sample += step) {
      const f = chord === 0 ? 0 : (sample - along) / chord;
      samples.corridorSamples[at] = (samples.corridorSamples[at] ?? 0) + 1;
      const near = index.kindsNear(ax + f * (bx - ax), ay + f * (by - ay), config.corridorRadiusM);
      if ((near & railBits) !== 0) samples.corridorRail[at] = (samples.corridorRail[at] ?? 0) + 1;
      if ((near & motorwayBits) !== 0)
        samples.corridorMotorway[at] = (samples.corridorMotorway[at] ?? 0) + 1;
    }
    along += chord;
  }
  return samples;
}

const emptyMapped: MappedPoint = {
  lat: null,
  lon: null,
  wayId: null,
  wayKind: null,
  snapM: null,
  path: null,
};

/** Length of a mapped interval: the matched positions and the way's shape between them. */
function mappedLength(from: MappedPoint, to: MappedPoint): number | null {
  if (from.lat === null || from.lon === null || to.lat === null || to.lon === null) return null;
  let length = 0;
  let previous = { lat: from.lat, lon: from.lon };
  for (const [lon, lat] of to.path ?? []) {
    const vertex = { lat, lon };
    length += haversineM(previous, vertex);
    previous = vertex;
  }
  return length + haversineM(previous, { lat: to.lat, lon: to.lon });
}

/**
 * The series of a move. `mapped` holds the move's mapped points (same order)
 * or null when they have none; `map` the way samples and stops of its area,
 * or null when that has no map data (a flight, or mapping switched off).
 */
export function moveSeries(
  points: readonly KeptPoint[],
  mapped: readonly MappedPoint[] | null,
  map: MoveMap | null,
  config: FeaturesConfig,
): MoveSeries {
  const count = points.length;
  const dt = new Float64Array(count);
  const distance = new Float64Array(count);
  const speed = new Float64Array(count);
  const families: (Partial<WayShares> | null)[] = new Array(count).fill(null);
  const ways = map?.ways ?? emptyWaySamples(count);
  const pois = map?.pois ?? null;
  const activity = points.map((point) => motionActivity(point.motion));
  const busStopPassed = points.map((point) =>
    pois === null ? null : (pois.nearest(point, ["bus_stop"], config.passRadiusM)?.id ?? null),
  );
  const tramStopPassed = points.map((point) =>
    pois === null ? null : (pois.nearest(point, ["tram_stop"], config.passRadiusM)?.id ?? null),
  );

  for (let k = 1; k < count; k += 1) {
    const from = points[k - 1];
    const to = points[k];
    if (from === undefined || to === undefined) continue;
    dt[k] = to.t - from.t;
    const chord = haversineM(from, to);
    const along =
      mapped === null ? null : mappedLength(mapped[k - 1] ?? emptyMapped, mapped[k] ?? emptyMapped);
    distance[k] = along ?? chord;
    speed[k] =
      (dt[k] ?? 0) <= config.denseIntervalS
        ? (from.speed + to.speed) / 2
        : (distance[k] ?? 0) / Math.max(1, dt[k] ?? 1);
    if (mapped !== null) {
      const share: Partial<WayShares> = {};
      for (const end of [mapped[k - 1], mapped[k]]) {
        const family = wayFamilyOf(end?.wayKind ?? null);
        share[family] = (share[family] ?? 0) + 0.5;
      }
      families[k] = share;
    }
  }

  // Pauses: points slower than `dwellSpeedMs` (the phone's own reading first) for long enough,
  // or a single slow reading between long intervals (sparse recording).
  const dwells: Dwell[] = [];
  if (pois !== null) {
    const slow = (point: KeptPoint) => (point.reportedSpeed ?? point.speed) <= config.dwellSpeedMs;
    let start = -1;
    const close = (end: number) => {
      const first = points[start];
      const last = points[end];
      if (start < 0 || first === undefined || last === undefined) return;
      const before = points[start - 1];
      const after = points[end + 1];
      const sparse =
        before !== undefined &&
        after !== undefined &&
        first.t - before.t >= 60 &&
        after.t - last.t >= 60;
      if (last.t - first.t >= config.dwellMinS || (start === end && sparse)) {
        let lat = 0;
        let lon = 0;
        for (let position = start; position <= end; position += 1) {
          lat += points[position]?.lat ?? 0;
          lon += points[position]?.lon ?? 0;
        }
        const size = end - start + 1;
        dwells.push({
          first: start,
          last: end,
          near: stopsNear({ lat: lat / size, lon: lon / size }, pois, config),
        });
      }
    };
    // The first and last points are the stops beside the move, not pauses in it.
    for (let position = 1; position < count - 1; position += 1) {
      const point = points[position];
      if (point !== undefined && slow(point)) {
        if (start < 0) start = position;
      } else if (start >= 0) {
        close(position - 1);
        start = -1;
      }
    }
    if (start >= 0) close(count - 2);
  }

  const nearStops = new Map<number, StopCounts>();
  const stopsAt = (position: number): StopCounts | null => {
    const point = points[position];
    if (pois === null || point === undefined) return null;
    let counts = nearStops.get(position);
    if (counts === undefined) {
      counts = stopsNear(point, pois, config);
      nearStops.set(position, counts);
    }
    return counts;
  };

  return {
    points,
    mapped: mapped !== null,
    dt,
    distance,
    speed,
    families,
    nearTram: ways.nearTram,
    nearCycleway: ways.nearCycleway,
    nearFoot: ways.nearFoot,
    activity,
    corridorSamples: ways.corridorSamples,
    corridorRail: ways.corridorRail,
    corridorMotorway: ways.corridorMotorway,
    dwells,
    busStopPassed,
    tramStopPassed,
    stopsAt,
  };
}
