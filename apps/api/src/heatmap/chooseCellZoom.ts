import { heatCellZoomRange } from "./heatCellLevels";

/**
 * How many levels finer than the map the cells are. MapLibre draws the slippy
 * tile of level z 512 px wide at map zoom z, so a cell of level zoom + 5 is
 * 16 px wide, and 11 to 23 px between two whole zooms (the dashboard rounds
 * the zoom it asks for).
 */
const cellZoomOffset = 5;

/**
 * The level of the heatmap's cells for a map zoom: round(zoom) + 5, within the
 * levels the heatmap answers at (docs/architecture.md §8.2). Past map zoom 13
 * the cells stay at the finest level and grow on screen.
 */
export function chooseCellZoom(mapZoom: number): number {
  const level = Math.round(mapZoom) + cellZoomOffset;
  return Math.min(heatCellZoomRange.max, Math.max(heatCellZoomRange.min, level));
}
