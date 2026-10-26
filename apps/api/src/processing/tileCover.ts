import { latToTileY, lonToTileX } from "../heatmap/tileMath";
import { haversineM } from "../tracks/haversine";
import type { KeptPoint } from "./keptPoint";
import type { ProcessingConfig } from "./processingConfig";

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
 * The tiles a move needs (docs/architecture.md §17.3, mapped): the candidate
 * radius around every point, a corridor around the straight line between
 * points far apart (the route between them runs there; min(1 km, 10 % of
 * the distance) on each side), and the station radius around both ends.
 */
export function moveTiles(points: readonly KeptPoint[], config: ProcessingConfig): Set<TileKey> {
  const { mapping } = config;
  const zoom = mapping.tileZoom;
  const tiles = new Set<TileKey>();
  for (const [position, point] of points.entries()) {
    addAround(tiles, point.lat, point.lon, mapping.maxRadiusM, zoom);
    const next = points[position + 1];
    if (next === undefined) continue;
    const chord = haversineM(point, next);
    if (chord <= 2 * mapping.maxRadiusM) continue;
    const buffer = Math.max(
      mapping.maxRadiusM,
      Math.min(mapping.corridorMaxM, mapping.corridorFactor * chord),
    );
    const step = Math.max(100, Math.min(buffer, halfTileM(zoom, point.lat)));
    const samples = Math.ceil(chord / step);
    for (let sample = 1; sample < samples; sample += 1) {
      const f = sample / samples;
      addAround(
        tiles,
        point.lat + f * (next.lat - point.lat),
        point.lon + f * (next.lon - point.lon),
        buffer,
        zoom,
      );
    }
  }
  for (const end of [points[0], points.at(-1)]) {
    if (end !== undefined)
      addAround(tiles, end.lat, end.lon, config.features.poiRadiusM.station, zoom);
  }
  return tiles;
}
