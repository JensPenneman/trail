import type { WayKind } from "@trail/contracts/transport";
import type { MapData, OsmPoi, OsmWay } from "../../src/processing/mapData";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import { subPath, toLonLat, travel, type Vertex } from "./syntheticWorld";

/*
 * A second hand-made world for the rail alignment, kept apart from
 * `worldMap()` so that every expectation built on that one stays as it is.
 * Metres east (x) and north (y) of the same point near Ghent; nothing here is
 * a real place or a real ride:
 *
 *  - a double-track main line, tracks A (y = 0) and B (y = 4.5), 100 km from
 *    west to east, with a gentle S-bend between 30 and 45 km;
 *  - a crossover between the two tracks at 5 km;
 *  - a road 40 m south of track A from 2 to 5 km (it never touches the rails);
 *  - a six-track station at 10 km (A, B and four more, 4.5 m apart) with a yard
 *    and a siding (`service` tags) beside it;
 *  - a branch that leaves track A at 15 km at 10 degrees, up to a terminus of
 *    four tracks with buffer stops;
 *  - a second line 150 m south of the main one from 12 to 16 km, joined to it
 *    at both ends.
 *
 * Ways meet where they share a vertex, as OSM ways share a node.
 */

export const railWorldLengthM = 100_000;
/** Track spacing, metres. */
export const trackSpacingM = 4.5;

const ways: OsmWay[] = [];
const pois: OsmPoi[] = [];
const nodeIds = new Map<string, number>();
let nextNode = 2_000_000_000;
let nextWay = 200_000_000;

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

function addPoi(id: string, [x, y]: Vertex, name: string): void {
  const [lon, lat] = toLonLat(x, y);
  pois.push({ id, kind: "station", lat, lon, name });
}

function addWay(
  kind: WayKind,
  vertices: readonly Vertex[],
  options: { service?: string; name?: string } = {},
): number {
  const id = nextWay;
  nextWay += 1;
  ways.push({
    id,
    kind,
    nodes: vertices.map(nodeAt),
    geometry: vertices.map(([x, y]) => toLonLat(x, y)),
    name: options.name ?? null,
    ...(options.service === undefined ? {} : { service: options.service }),
  });
  return id;
}

/** The S-bend of the main line between 30 and 45 km: 0 outside it, 1200 m at its middle. */
export const bendY = (x: number): number =>
  x > 30_000 && x < 45_000 ? 1200 * Math.sin((Math.PI * (x - 30_000)) / 15_000) ** 2 : 0;

/** Where the main tracks are cut into ways: junctions, the station, every 5 km. */
const breakpoints = [
  ...new Set([
    ...Array.from({ length: railWorldLengthM / 5000 + 1 }, (_, index) => index * 5000),
    4950,
    5050,
    9200,
    10_800,
    11_500,
    15_000,
    16_500,
  ]),
].sort((a, b) => a - b);

/** The vertices of a main track `offset` metres north of track A, between two x. */
function mainVertices(offset: number, from: number, to: number): Vertex[] {
  const xs = new Set<number>([from, to]);
  for (let x = Math.ceil(from / 250) * 250; x < to; x += 250) xs.add(x);
  for (const x of breakpoints) if (x > from && x < to) xs.add(x);
  return [...xs].sort((a, b) => a - b).map((x) => [x, bendY(x) + offset] as const);
}

const trackOffsets = { a: 0, b: trackSpacingM } as const;

/** The whole of one main track, for journeys. */
export const trackA: Vertex[] = mainVertices(trackOffsets.a, 0, railWorldLengthM);
export const trackB: Vertex[] = mainVertices(trackOffsets.b, 0, railWorldLengthM);

for (const offset of Object.values(trackOffsets)) {
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const from = breakpoints[index];
    const to = breakpoints[index + 1];
    if (from === undefined || to === undefined) continue;
    addWay("rail", mainVertices(offset, from, to), {
      name: offset === 0 ? "Line 1 up" : "Line 1 down",
    });
  }
}
// A crossover between the two tracks.
addWay(
  "rail",
  [
    [4950, 0],
    [5050, trackSpacingM],
  ],
  { service: "crossover" },
);

// The road beside the line, 40 m south of track A.
export const roadLine: Vertex[] = Array.from({ length: 13 }, (_, index) => [
  2000 + index * 250,
  -40,
]);
addWay("secondary", roadLine, { name: "Road along the line" });

// The six-track station at 10 km: the main tracks and four more, 4.5 m apart.
export const stationX = 10_000;
export const stationTracks: Vertex[][] = [];
for (const [index, y] of [9, 13.5, 18, 22.5].entries()) {
  const track: Vertex[] = [
    [9200, trackSpacingM],
    [9300, y],
    [10_700, y],
    [10_800, trackSpacingM],
  ];
  stationTracks.push(track);
  addWay("rail", track, { name: `Station track ${index + 3}` });
}
export const yardTrack: Vertex[] = [
  [9200, trackSpacingM],
  [9300, 27],
  [10_500, 27],
];
addWay("rail", yardTrack, { service: "yard" });
export const sidingTrack: Vertex[] = [
  [9200, 0],
  [9300, -9],
  [10_300, -9],
];
addWay("rail", sidingTrack, { service: "siding" });
addPoi("n900001", [stationX, 30], "Main station");

// The branch, leaving track A at 15 km at 10 degrees, and its terminus.
const branchAngle = (10 * Math.PI) / 180;
const alongBranch = (s: number, side = 0): Vertex => [
  15_000 + s * Math.cos(branchAngle) - side * Math.sin(branchAngle),
  s * Math.sin(branchAngle) + side * Math.cos(branchAngle),
];
export const branchLine: Vertex[] = Array.from({ length: 37 }, (_, index) =>
  alongBranch(index * 250),
);
addWay("rail", branchLine, { name: "Branch" });
export const terminusTracks: Vertex[][] = [0, 1, 2, 3].map((side) => [
  alongBranch(9000),
  alongBranch(9100, side * 5),
  alongBranch(9800, side * 5),
]);
for (const track of terminusTracks) addWay("rail", track);
addPoi("n900002", alongBranch(9500, -20), "Terminus");

// The second line, 150 m south of the main one, joined to it at both ends.
export const parallelLine: Vertex[] = Array.from({ length: 17 }, (_, index) => [
  12_000 + index * 250,
  -150,
]);
addWay(
  "rail",
  [
    [11_500, 0],
    [12_000, -150],
  ],
  { name: "Second line" },
);
addWay("rail", parallelLine, { name: "Second line" });
addWay(
  "rail",
  [
    [16_000, -150],
    [16_500, 0],
  ],
  { name: "Second line" },
);

/** The whole world as map data (a fresh copy every time). */
export function railWorld(): MapData {
  return {
    ways: ways.map((way) => ({ ...way })),
    pois: pois.map((poi) => ({ ...poi })),
  };
}

export interface RailRideOptions {
  /** Seconds between points. */
  intervalS: number;
  /** Standard deviation of the noise per axis, metres. */
  noiseM?: number;
  accuracy?: number;
  startT?: number;
  speedMs?: number;
  seed?: number;
}

/** A train ride along `path` (metres) as phone points; no pauses, no CoreMotion. */
export function railRide(path: readonly Vertex[], options: RailRideOptions): RawPoint[] {
  return travel(path, {
    startT: options.startT ?? 1_800_000_000,
    speedMs: options.speedMs ?? 30,
    intervalS: options.intervalS,
    noiseM: options.noiseM ?? 0,
    accuracy: options.accuracy ?? 5,
    reportSpeed: false,
    seed: options.seed ?? 1,
  });
}

/** The path from `from` on track A to the branch's terminus: through the junction at 15 km. */
export function pathToTerminus(from = 5000): Vertex[] {
  return [
    ...subPath(trackA, from, 15_000),
    ...branchLine.slice(1),
    ...(terminusTracks[0] ?? []).slice(1),
  ];
}

const oplCoordinate = (degrees: number): string => degrees.toFixed(7);
const kindTags: Partial<Record<WayKind, string>> = {
  rail: "railway=rail",
  secondary: "highway=secondary",
};

/** The ways of `map` as the lines of ways.opl.gz (kinds rail and secondary only: this world's). */
export function oplLinesOf(map: MapData): string[] {
  return map.ways.map((way) => {
    const tags = [kindTags[way.kind] ?? "highway=service"];
    if (way.service !== undefined && way.service !== null) tags.push(`service=${way.service}`);
    const nodes = way.nodes.map((node, index) => {
      const [lon, lat] = way.geometry[index] ?? [0, 0];
      return `n${node}x${oplCoordinate(lon)}y${oplCoordinate(lat)}`;
    });
    return `w${way.id} T${tags.join(",")} N${nodes.join(",")}`;
  });
}

/** A region.poly (Osmosis polygon filter format) of one outline given as `[lon, lat]` corners. */
export function regionPolyText(
  name: string,
  outline: readonly (readonly [number, number])[],
): string {
  const lines = outline.map(([lon, lat]) => `   ${lon.toFixed(6)}E+00   ${lat.toFixed(6)}E+00`);
  return `${name}\n1\n${lines.join("\n")}\nEND\nEND\n`;
}
