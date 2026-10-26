import { latToTileY, lonToTileX } from "../heatmap/tileMath";
import { haversineM } from "../tracks/haversine";
import type { KeptPoint } from "./keptPoint";
import type { ProcessingConfig } from "./processingConfig";
import { weightedQuantile } from "./weightedQuantile";

/** A map tile as `z/x/y`. */
export type TileKey = string;

export const tileKey = (z: number, x: number, y: number): TileKey => `${z}/${x}/${y}`;

export function parseTileKey(key: TileKey): { z: number; x: number; y: number } | null {
  const match = /^(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/.exec(key);
  if (match === null) return null;
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

const metresPerDegree = 111_195;

/** Adds the tiles that cover `radiusM` around a position. */
function addAround(
  tiles: Set<TileKey>,
  lat: number,
  lon: number,
  radiusM: number,
  zoom: number,
): void {
  const dLat = radiusM / metresPerDegree;
  const dLon = radiusM / (metresPerDegree * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const west = lonToTileX(lon - dLon, zoom);
  const east = lonToTileX(lon + dLon, zoom);
  const north = latToTileY(lat + dLat, zoom);
  const south = latToTileY(lat - dLat, zoom);
  for (let x = west; x <= east; x += 1) {
    for (let y = north; y <= south; y += 1) tiles.add(tileKey(zoom, x, y));
  }
}

/** Roughly half the width of a tile at this zoom and latitude, metres. */
const halfTileM = (zoom: number, lat: number): number =>
  (40_075_016 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom / 2;

/**
 * Adds the tiles position `k` of a move needs (docs/architecture.md §17.3,
 * mapped): the candidate radius around the point, the station radius at the
 * move's ends and, with `withInterval`, a corridor around the straight line
 * from the point before when the two are far apart (the route between them
 * runs there; min(1 km, 10 % of the distance) on each side) — unless covering
 * that distance took more than ground speed.
 */
function addPositionTiles(
  tiles: Set<TileKey>,
  points: readonly KeptPoint[],
  k: number,
  withInterval: boolean,
  config: ProcessingConfig,
): void {
  const { mapping } = config;
  const zoom = mapping.tileZoom;
  const point = points[k];
  if (point === undefined) return;
  addAround(tiles, point.lat, point.lon, mapping.maxRadiusM, zoom);
  if (k === 0 || k === points.length - 1)
    addAround(tiles, point.lat, point.lon, config.features.poiRadiusM.station, zoom);
  const previous = points[k - 1];
  if (!withInterval || previous === undefined) return;
  const chord = haversineM(previous, point);
  if (chord <= 2 * mapping.maxRadiusM) return;
  if (chord > mapping.groundMaxSpeedMs * Math.max(1, point.t - previous.t)) return;
  const buffer = Math.max(
    mapping.maxRadiusM,
    Math.min(mapping.corridorMaxM, mapping.corridorFactor * chord),
  );
  const step = Math.max(100, Math.min(buffer, halfTileM(zoom, previous.lat)));
  const samples = Math.ceil(chord / step);
  for (let sample = 1; sample < samples; sample += 1) {
    const f = sample / samples;
    addAround(
      tiles,
      previous.lat + f * (point.lat - previous.lat),
      previous.lon + f * (point.lon - previous.lon),
      buffer,
      zoom,
    );
  }
}

/** The tiles position `k` of a move adds, with the corridor from the point before or without. */
export function positionTiles(
  points: readonly KeptPoint[],
  k: number,
  withInterval: boolean,
  config: ProcessingConfig,
): Set<TileKey> {
  const tiles = new Set<TileKey>();
  addPositionTiles(tiles, points, k, withInterval, config);
  return tiles;
}

/** The tiles positions `from..to` of a move need (the corridor into `from` comes with the point before). */
export function stretchTiles(
  points: readonly KeptPoint[],
  from: number,
  to: number,
  config: ProcessingConfig,
): Set<TileKey> {
  const tiles = new Set<TileKey>();
  for (let k = from; k <= to; k += 1) addPositionTiles(tiles, points, k, k > from, config);
  return tiles;
}

/** The tiles a move on the ground needs. */
export function moveTiles(points: readonly KeptPoint[], config: ProcessingConfig): Set<TileKey> {
  return stretchTiles(points, 0, points.length - 1, config);
}

/**
 * Whether a move is a flight: its typical speed (the time-weighted median of
 * the speeds between its points) is beyond anything on the ground. Nothing on
 * the map explains a flight, so it needs no map data.
 */
export function isAirborne(points: readonly KeptPoint[], config: ProcessingConfig): boolean {
  const speeds: number[] = [];
  const weights: number[] = [];
  for (let k = 1; k < points.length; k += 1) {
    const from = points[k - 1];
    const to = points[k];
    if (from === undefined || to === undefined || to.t <= from.t) continue;
    speeds.push(haversineM(from, to) / (to.t - from.t));
    weights.push(to.t - from.t);
  }
  return (
    speeds.length > 0 && weightedQuantile(speeds, weights, 0.5) > config.mapping.groundMaxSpeedMs
  );
}
