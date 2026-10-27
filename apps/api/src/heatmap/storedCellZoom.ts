import { heatCellZooms } from "./heatCellLevels";

/**
 * The stored level that cells of `cellZoom` are summed from: the coarsest
 * stored level that is at least as fine, so a cell sums at most 4 × 4 stored
 * ones (the stored levels are three apart).
 */
export function storedCellZoom(cellZoom: number): number {
  for (const level of heatCellZooms) if (level >= cellZoom) return level;
  throw new RangeError(`No stored heat cells as fine as level ${cellZoom}`);
}
