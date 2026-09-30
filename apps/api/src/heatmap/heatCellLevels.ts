/** Slippy-map zoom levels that heat cells are aggregated at (docs/architecture.md §5). */
export const heatCellZooms = [6, 9, 12, 15, 18] as const;

/** Points less accurate than this (metres) stay out of the heatmap; unknown accuracy counts. */
export const heatCellMaxAccuracy = 200;

/** Web Mercator stops here; tile maths is undefined at the poles. */
export const mercatorMaxLatitude = 85.0511287798;
