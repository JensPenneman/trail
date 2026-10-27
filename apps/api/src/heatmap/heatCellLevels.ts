/**
 * Slippy-map zoom levels that heat cells are stored at (docs/architecture.md
 * §5). Level 20 (about 24 m at 51° N) is the finest worth keeping: GPS
 * accuracy makes anything finer noise.
 */
export const heatCellZooms = [6, 9, 12, 15, 18, 20] as const;

/**
 * The levels the heatmap answers at: every level from the coarsest stored one
 * to the finest, those between summed from the next finer stored level.
 */
export const heatCellZoomRange = { min: heatCellZooms[0], max: heatCellZooms[5] } as const;

/** Points less accurate than this (metres) stay out of the heatmap; unknown accuracy counts. */
export const heatCellMaxAccuracy = 200;

/** Web Mercator stops here; tile maths is undefined at the poles. */
export const mercatorMaxLatitude = 85.0511287798;
