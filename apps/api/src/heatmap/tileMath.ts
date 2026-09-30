import { mercatorMaxLatitude } from "./heatCellLevels";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Slippy-map tile column of a longitude at zoom `z` (same formula as the ingest SQL). */
export function lonToTileX(lon: number, z: number): number {
  const tiles = 2 ** z;
  return clamp(Math.floor(((lon + 180) / 360) * tiles), 0, tiles - 1);
}

/** Slippy-map tile row of a latitude at zoom `z` (Web Mercator, clamped at ±85.05°). */
export function latToTileY(lat: number, z: number): number {
  const tiles = 2 ** z;
  const radians = (clamp(lat, -mercatorMaxLatitude, mercatorMaxLatitude) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * tiles;
  return clamp(Math.floor(y), 0, tiles - 1);
}

/** Centre `[lon, lat]` of tile (x, y) at zoom `z`. */
export function tileCentre(x: number, y: number, z: number): [number, number] {
  const tiles = 2 ** z;
  const lon = ((x + 0.5) / tiles) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / tiles))) * 180) / Math.PI;
  return [lon, lat];
}
