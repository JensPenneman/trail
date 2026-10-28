import { mercatorMaxLatitude } from "../heatmap/heatCellLevels";
import { forEachCell } from "../processing/gridCells";

/** The zoom of the tile index (`mapping.tileZoom`, docs/architecture.md §17.3). */
export const tileZoom = 14;
const tiles = 2 ** tileZoom;
/** No real way crosses this many z14 tiles (Belgium's longest: 458); one that does is refused. */
export const maxTilesPerWay = 10_000;
/** The cells a way's segments may visit together, revisits included: a bound on the work. */
const maxVisitsPerWay = 100_000;

const clampTile = (value: number): number => Math.min(tiles - 1, Math.max(0, Math.floor(value)));

/** The tile column at z14 as a fraction (tileMath's lonToTileX before its floor). */
const tileX = (lonE7: number): number => ((lonE7 / 1e7 + 180) / 360) * tiles;

/** The tile row at z14 as a fraction (tileMath's latToTileY before its floor). */
function tileY(latE7: number): number {
  const lat = Math.min(mercatorMaxLatitude, Math.max(-mercatorMaxLatitude, latE7 / 1e7));
  const radians = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * tiles;
}

/** The key of tile (x, y) at z14 in the set `wayTiles` returns. */
const tileNumber = (x: number, y: number): number => x * tiles + y;

/** Tile (x, y) of a key of `wayTiles`. */
export const tileOfNumber = (key: number): [number, number] => [
  Math.floor(key / tiles),
  key % tiles,
];

/**
 * The z14 tiles a way's segments pass through, the same tiles
 * `moveTiles`/`planPieces` ask for (tileMath's slippy-map formulas), walked
 * with the way index's grid traversal in tile units. Null when the way
 * crosses more than `maxTilesPerWay` tiles or would take more work than any
 * real way does (a segment across the antimeridian sweeps the whole world).
 */
export function wayTiles(lonLatE7: Int32Array): Set<number> | null {
  const found = new Set<number>();
  const count = lonLatE7.length / 2;
  let visits = 0;
  let ax = tileX(lonLatE7[0] ?? 0);
  let ay = tileY(lonLatE7[1] ?? 0);
  found.add(tileNumber(clampTile(ax), clampTile(ay)));
  for (let vertex = 1; vertex < count; vertex += 1) {
    const bx = tileX(lonLatE7[vertex * 2] ?? 0);
    const by = tileY(lonLatE7[vertex * 2 + 1] ?? 0);
    visits +=
      Math.abs(Math.floor(bx) - Math.floor(ax)) + Math.abs(Math.floor(by) - Math.floor(ay)) + 2;
    if (visits > maxVisitsPerWay) return null;
    forEachCell(ax, ay, bx, by, 1, (cx, cy) => {
      found.add(tileNumber(clampTile(cx), clampTile(cy)));
    });
    if (found.size > maxTilesPerWay) return null;
    ax = bx;
    ay = by;
  }
  return found;
}
