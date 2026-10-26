import type { WayKind } from "@trail/contracts/transport";
import type { MapData, OsmPoi, OsmWay, PoiKind } from "../../src/processing/mapData";
import type { RawPoint } from "../../src/processing/pipelineTypes";

/*
 * A small hand-made world for the processing tests, laid out in metres east (x)
 * and north (y) of a point near Ghent: a curving railway with two stations and
 * a halt, a motorway, two street grids (one around each station) with a main
 * road and its bus stops, a cycleway, a park footpath, a tram line in a street
 * with its stops, a subway line, and a ferry across a river. Ways meet where
 * they share a vertex, as OSM ways share a node.
 */

export const origin = { lat: 51.0, lon: 3.7 };
const metresPerDegree = 111_195;
const kx = metresPerDegree * Math.cos((origin.lat * Math.PI) / 180);

export const toLonLat = (x: number, y: number): [number, number] => [
  origin.lon + x / kx,
  origin.lat + y / metresPerDegree,
];

export type Vertex = readonly [number, number];

const ways: OsmWay[] = [];
const pois: OsmPoi[] = [];
const nodeIds = new Map<string, number>();
let nextNode = 1_000_000_000;
let nextWay = 100_000_000;

function nodeAt([x, y]: Vertex): number {
  const key = `${x.toFixed(3)}:${y.toFixed(3)}`;
  let id = nodeIds.get(key);
  if (id === undefined) {
    id = nextNode;
    nextNode += 1;
    nodeIds.set(key, id);
  }
  return id;
}

function addWay(kind: WayKind, vertices: readonly Vertex[], name: string | null = null): number {
  const id = nextWay;
  nextWay += 1;
  ways.push({
    id,
    kind,
    nodes: vertices.map(nodeAt),
    geometry: vertices.map(([x, y]) => toLonLat(x, y)),
    name,
  });
  return id;
}

function addPoi(kind: PoiKind, [x, y]: Vertex, name: string): void {
  const [lon, lat] = toLonLat(x, y);
  pois.push({ id: `n${900_000 + pois.length}`, kind, lat, lon, name });
}

/** Evenly spaced vertices of y = f(x) from x0 to x1. */
function curve(x0: number, x1: number, step: number, f: (x: number) => number): Vertex[] {
  const vertices: Vertex[] = [];
  const count = Math.round(Math.abs(x1 - x0) / step);
  for (let index = 0; index <= count; index += 1) {
    const x = x0 + ((x1 - x0) * index) / count;
    vertices.push([x, f(x)]);
  }
  return vertices;
}

const range = (from: number, to: number, step: number): number[] => {
  const values: number[] = [];
  for (let value = from; value <= to + 1e-9; value += step) values.push(value);
  return values;
};

// The railway: station A at (0, 0), a halt at 15 km, station B at (30 km, 2 km), in four ways.
export const railY = (x: number): number =>
  (2000 * x) / 30_000 + 600 * Math.sin((2 * Math.PI * x) / 15_000);
export const railLine: Vertex[] = curve(0, 30_000, 250, railY);
for (const [from, to] of [
  [0, 8000],
  [8000, 15_000],
  [15_000, 22_000],
  [22_000, 30_000],
] as const) {
  addWay(
    "rail",
    railLine.filter(([x]) => x >= from && x <= to),
    "Line 50",
  );
}
export const stationA: Vertex = [0, railY(0)];
export const halt: Vertex = [15_000, railY(15_000)];
export const stationB: Vertex = [30_000, railY(30_000)];
addPoi("station", [0, 40], "Station A");
addPoi("halt", [15_000, railY(15_000) + 25], "Halt");
addPoi("station", [30_000, railY(30_000) + 40], "Station B");

// The motorway, 3 km south of the railway.
export const motorwayLine: Vertex[] = curve(
  -2000,
  30_000,
  500,
  (x) => -3000 + 300 * Math.sin(x / 4000),
);
addWay(
  "motorway",
  motorwayLine.filter(([x]) => x <= 14_000),
  "E40",
);
addWay(
  "motorway",
  motorwayLine.filter(([x]) => x >= 14_000),
  "E40",
);

/** A street grid: horizontal and vertical streets through every crossing. */
function grid(
  xs: readonly number[],
  ys: readonly number[],
  kind: WayKind,
  mainX: number | null,
): void {
  for (const y of ys)
    addWay(
      kind,
      xs.map((x) => [x, y] as const),
    );
  for (const x of xs)
    addWay(
      x === mainX ? "primary" : kind,
      ys.map((y) => [x, y] as const),
    );
}
// Around station A: streets west of it, the main road at x = -1000.
export const gridAXs = range(-2000, -200, 200);
export const gridAYs = range(-800, 800, 200);
grid(gridAXs, gridAYs, "residential", -1000);
// The station forecourt joins the grid to the platform.
addWay("service", [
  [-200, 0],
  [-100, 0],
  [0, 15],
]);
// The main road continues north out of the grid; bus stops every 400 m on it.
export const mainRoad: Vertex[] = range(-800, 4800, 200).map((y) => [-1000, y] as const);
addWay(
  "primary",
  mainRoad.filter(([, y]) => y >= 800),
  "Main Road",
);
export const busStops: Vertex[] = range(-400, 4400, 800).map((y) => [-1000 + 8, y] as const);
for (const [index, stop] of busStops.entries()) addPoi("bus_stop", stop, `Bus stop ${index + 1}`);

// Around station B.
export const gridBXs = range(30_200, 31_400, 200);
export const gridBYs = range(1600, 2600, 200);
grid(gridBXs, gridBYs, "residential", null);
addWay("service", [
  [30_000, railY(30_000) + 15],
  [30_100, 2000],
  [30_200, 2000],
]);

// A cycleway west of town, curving gently.
export const cyclewayLine: Vertex[] = curve(
  -3000,
  -9000,
  100,
  (x) => -2000 + 150 * Math.sin(x / 700),
);
addWay("cycleway", cyclewayLine, "Cycle route");

// A park footpath, winding north-west from the grid's corner.
export const footpathLine: Vertex[] = range(0, 2000, 50).map(
  (s) => [-2000 - s * 0.7, 800 + s * 0.7 + 40 * Math.sin(s / 120)] as const,
);
addWay("footway", footpathLine, "Park path");

// A tram line along a street: the tracks 3 m from the road's centre line.
export const tramStreet: Vertex[] = curve(-3000, -8000, 100, () => 3000);
addWay("tertiary", tramStreet, "Tram Street");
export const tramLine: Vertex[] = curve(-3000, -8000, 100, () => 3003);
addWay("tram", tramLine, "Tram 1");
export const tramStops: Vertex[] = range(3500, 7500, 500).map((s) => [-s, 3010] as const);
for (const [index, stop] of tramStops.entries())
  addPoi("tram_stop", stop, `Tram stop ${index + 1}`);

// A subway line underground, with stations every kilometre.
export const subwayLine: Vertex[] = curve(-4000, -10_000, 200, () => 6000);
addWay("subway", subwayLine, "Metro 1");
for (const x of range(4000, 10_000, 1000))
  addPoi("subway_station", [-x, 6020], `Metro ${x / 1000}`);

// A ferry across a river: 3 km from terminal to terminal, a road to each.
export const ferryLine: Vertex[] = range(8000, 11_000, 100).map(
  (distance) => [5000 + 30 * Math.sin(-distance / 500), -distance] as const,
);
addWay("ferry", ferryLine, "River ferry");
addWay("secondary", [
  [5000, -7000],
  [5000, -8000],
]);
addWay("secondary", [
  [5000 + 30 * Math.sin(-11_000 / 500), -11_000],
  [5000, -12_000],
]);
addPoi("ferry_terminal", [5010, -8000], "North quay");
addPoi("ferry_terminal", [5010, -11_000], "South quay");

/** The whole world as map data. */
export function worldMap(): MapData {
  return { ways: ways.map((way) => ({ ...way })), pois: pois.map((poi) => ({ ...poi })) };
}

/** Deterministic pseudo-random numbers (mulberry32). */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A standard normal sample (Box–Muller). */
function gaussian(next: () => number): number {
  const u = Math.max(1e-12, next());
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface TrackOptions {
  /** Epoch seconds of the first point. */
  startT: number;
  speedMs: number;
  /** Seconds between points, or a function of the point's number. */
  intervalS: number | ((index: number) => number);
  /** Standard deviation of the GPS noise per axis, metres. */
  noiseM?: number;
  accuracy?: number | null;
  motion?: readonly string[];
  /** Whether the phone reports its speed. */
  reportSpeed?: boolean;
  altitude?: number | null;
  seed?: number;
  /** Pauses on the way: at this distance along the path, for this long. */
  pauses?: readonly { atM: number; seconds: number }[];
}

/** A point `distance` metres along a polyline (clamped to its ends). */
export function pointAlong(path: readonly Vertex[], distance: number): Vertex {
  let remaining = Math.max(0, distance);
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length) {
      const f = length === 0 ? 0 : remaining / length;
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    }
    remaining -= length;
  }
  return path.at(-1) ?? [0, 0];
}

export function pathLength(path: readonly Vertex[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    if (a !== undefined && b !== undefined) length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}

/** Part of a polyline between two distances along it. */
export function subPath(path: readonly Vertex[], from: number, to: number): Vertex[] {
  const vertices: Vertex[] = [pointAlong(path, from)];
  let travelled = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    if (a === undefined || b === undefined) continue;
    travelled += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (travelled > from && travelled < to) vertices.push(b);
  }
  vertices.push(pointAlong(path, to));
  return vertices;
}

/**
 * Points of a phone travelling along `path` at a constant speed (pausing where
 * asked), sampled every `intervalS` seconds, with GPS noise.
 */
export function travel(path: readonly Vertex[], options: TrackOptions): RawPoint[] {
  const next = random(options.seed ?? 1);
  const length = pathLength(path);
  const points: RawPoint[] = [];
  const pauses = [...(options.pauses ?? [])].sort((a, b) => a.atM - b.atM);
  // Distance travelled at time τ after the start, with the pauses.
  const distanceAt = (tau: number): { distance: number; moving: boolean } => {
    let time = tau;
    let distance = 0;
    for (const pause of pauses) {
      const reach = (pause.atM - distance) / options.speedMs;
      if (time <= reach) return { distance: distance + time * options.speedMs, moving: true };
      time -= reach;
      distance = pause.atM;
      if (time <= pause.seconds) return { distance, moving: false };
      time -= pause.seconds;
    }
    return { distance: distance + time * options.speedMs, moving: true };
  };
  const totalTime =
    length / options.speedMs + pauses.reduce((sum, pause) => sum + pause.seconds, 0);
  let tau = 0;
  for (let index = 0; tau <= totalTime + 1e-9; index += 1) {
    const { distance, moving } = distanceAt(tau);
    const [x, y] = pointAlong(path, Math.min(distance, length));
    const noise = options.noiseM ?? 0;
    const [lon, lat] = toLonLat(x + noise * gaussian(next), y + noise * gaussian(next));
    points.push({
      t: options.startT + Math.round(tau),
      lat,
      lon,
      accuracy: options.accuracy === undefined ? 5 : options.accuracy,
      speed: options.reportSpeed === false ? null : moving ? options.speedMs : 0,
      altitude: options.altitude ?? null,
      verticalAccuracy: options.altitude === undefined || options.altitude === null ? null : 4,
      motion: [...(options.motion ?? [])],
    });
    const step =
      typeof options.intervalS === "number" ? options.intervalS : options.intervalS(index);
    tau += Math.max(1, step);
  }
  return dedupeSeconds(points);
}

/** A phone lying still at a place: noise around it. */
export function stay(
  at: Vertex,
  options: {
    startT: number;
    durationS: number;
    intervalS: number;
    noiseM?: number;
    accuracy?: number;
    motion?: readonly string[];
    seed?: number;
  },
): RawPoint[] {
  const next = random(options.seed ?? 7);
  const points: RawPoint[] = [];
  for (let tau = 0; tau <= options.durationS; tau += options.intervalS) {
    const noise = options.noiseM ?? 4;
    const [lon, lat] = toLonLat(at[0] + noise * gaussian(next), at[1] + noise * gaussian(next));
    points.push({
      t: options.startT + Math.round(tau),
      lat,
      lon,
      accuracy: options.accuracy ?? 10,
      speed: 0,
      altitude: null,
      verticalAccuracy: null,
      motion: [...(options.motion ?? ["stationary"])],
    });
  }
  return dedupeSeconds(points);
}

/** Overland stores one point per second: later duplicates of a second are dropped. */
function dedupeSeconds(points: RawPoint[]): RawPoint[] {
  const seen = new Set<number>();
  return points.filter((point) => {
    if (seen.has(point.t)) return false;
    seen.add(point.t);
    return true;
  });
}

/** Legs one after the other: each next leg's points after the previous leg's last one. */
export function concat(...legs: RawPoint[][]): RawPoint[] {
  const points: RawPoint[] = [];
  for (const leg of legs) {
    const last = points.at(-1)?.t ?? Number.NEGATIVE_INFINITY;
    for (const point of leg) if (point.t > last) points.push(point);
  }
  return points;
}

export const lastT = (points: readonly RawPoint[]): number => points.at(-1)?.t ?? 0;

/** Metres east/north of the world's origin for a point. */
export const toXY = (point: { lat: number; lon: number }): [number, number] => [
  (point.lon - origin.lon) * kx,
  (point.lat - origin.lat) * metresPerDegree,
];

/** Distance from a point (metres) to a polyline. */
export function distanceToLine(point: Vertex, line: readonly Vertex[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1];
    const b = line[index];
    if (a === undefined || b === undefined) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(
            1,
            Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
          );
    best = Math.min(best, Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy)));
  }
  return best;
}
