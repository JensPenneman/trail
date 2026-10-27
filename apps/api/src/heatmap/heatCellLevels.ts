/** Slippy-map zoom levels that heat cells are stored at (docs/architecture.md §5). */
export const heatCellZooms = [6, 9, 12, 15, 18] as const;

/**
 * The levels the heatmap answers at: every level from the coarsest stored one
 * to the finest, those between summed from the next finer stored level.
 */
export const heatCellZoomRange = { min: heatCellZooms[0], max: heatCellZooms[4] } as const;

/** Points less accurate than this (metres) stay out of the heatmap; unknown accuracy counts. */
export const heatCellMaxAccuracy = 200;

/** Web Mercator stops here; tile maths is undefined at the poles. */
export const mercatorMaxLatitude = 85.0511287798;
