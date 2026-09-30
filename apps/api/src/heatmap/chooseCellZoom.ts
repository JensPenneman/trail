import { heatCellZooms } from "./heatCellLevels";

/**
 * Cell resolution for a map zoom: the largest stored level ≤ round(zoom) + 5,
 * i.e. cells about 32 px wide on screen (docs/architecture.md §8.2).
 */
export function chooseCellZoom(mapZoom: number): number {
  const limit = Math.round(mapZoom) + 5;
  let chosen: number = heatCellZooms[0];
  for (const level of heatCellZooms) if (level <= limit) chosen = level;
  return chosen;
}
