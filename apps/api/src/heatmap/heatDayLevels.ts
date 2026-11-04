/**
 * The levels `heat_days` stores (docs/architecture.md §5): a day's cells are far fewer than a
 * lifetime's, so three levels, three or six apart, serve every cell zoom the heatmap answers at
 * from 6 to 18 (a cell sums at most 4^6 stored ones); the finer cells of zooms 19 and 20 are
 * answered at 18.
 */
export const heatDayZooms = [12, 15, 18] as const;

/** No interval to the next kept point counts for more than this many seconds (a recording gap). */
export const heatDayMaxIntervalS = 600;

/** The stored level a cell zoom is read from, and the zoom the cells are then answered at. */
export function heatDayLevelFor(cellZoom: number): { stored: number; cellZoom: number } {
  const zoom = Math.min(cellZoom, heatDayZooms[2]);
  const stored = heatDayZooms.find((level) => level >= zoom) ?? heatDayZooms[2];
  return { stored, cellZoom: zoom };
}
