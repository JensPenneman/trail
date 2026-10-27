import { storedCellZoom } from "./storedCellZoom";
import { latToTileY, lonToTileX } from "./tileMath";

/** The stored cells that a heatmap of one level over a viewport sums up. */
export interface HeatCellWindow {
  /** The stored level read. */
  stored: number;
  /** How many levels finer the stored level is: stored cell (x, y) adds to cell (x >> shift, y >> shift). */
  shift: number;
  /** Stored rows, both ends included. */
  rows: readonly [number, number];
  /** Stored columns, both ends included; with `wraps` the columns from the first to the world's edge and from 0 to the second. */
  columns: readonly [number, number];
  /** The viewport crosses the antimeridian (west > east). */
  wraps: boolean;
}

/**
 * The stored cells under the cells of level `cellZoom` that a viewport
 * touches (docs/architecture.md §8.2): whole cells, so that a cell at the edge
 * of the view counts every stored cell it holds, as it does in the middle.
 */
export function heatCellWindow(
  bbox: readonly [number, number, number, number],
  cellZoom: number,
): HeatCellWindow {
  const stored = storedCellZoom(cellZoom);
  const shift = stored - cellZoom;
  const first = (cell: number) => cell * 2 ** shift;
  const last = (cell: number) => (cell + 1) * 2 ** shift - 1;
  const [west, south, east, north] = bbox;
  return {
    stored,
    shift,
    rows: [
      first(latToTileY(Math.max(north, south), cellZoom)),
      last(latToTileY(Math.min(north, south), cellZoom)),
    ],
    columns: [first(lonToTileX(west, cellZoom)), last(lonToTileX(east, cellZoom))],
    wraps: west > east,
  };
}
