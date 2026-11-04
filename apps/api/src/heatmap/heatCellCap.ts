import { heatCellCeiling } from "@trail/contracts/heatmap";
import { latToTileY, lonToTileX } from "./tileMath";

/** The whole cells of one level a viewport touches: rows and columns, both ends included. */
export interface ViewCells {
  rows: readonly [number, number];
  columns: readonly [number, number];
  /** The viewport crosses the antimeridian (west > east): columns run from the first to the edge and from 0 to the second. */
  wraps: boolean;
  /** How many cells that is. */
  count: number;
}

/** The cells of level `cellZoom` that `bbox` (`west, south, east, north`) touches, partly or whole. */
export function viewCells(
  bbox: readonly [number, number, number, number],
  cellZoom: number,
): ViewCells {
  const [west, south, east, north] = bbox;
  const first = latToTileY(Math.max(north, south), cellZoom);
  const last = latToTileY(Math.min(north, south), cellZoom);
  const from = lonToTileX(west, cellZoom);
  const to = lonToTileX(east, cellZoom);
  const wraps = west > east;
  const columns = wraps ? 2 ** cellZoom - from + to + 1 : to - from + 1;
  return { rows: [first, last], columns: [from, to], wraps, count: (last - first + 1) * columns };
}

/**
 * The most cells an answer carries (docs/architecture.md §8.2): as many as the viewport can hold,
 * at most `heatCellCeiling`. Cells are 11 to 23 CSS pixels wide, so a screen of 3840 × 2160 holds
 * up to some 65 000; a viewport that touches fewer cells than that cannot be truncated.
 */
export function heatCellCap(
  bbox: readonly [number, number, number, number],
  cellZoom: number,
): number {
  return Math.max(1, Math.min(viewCells(bbox, cellZoom).count, heatCellCeiling));
}
