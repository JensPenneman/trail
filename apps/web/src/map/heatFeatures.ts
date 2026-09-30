/**
 * Heat cells as weighted points. Counts range from one to hundreds of
 * thousands, so the weight is logarithmic and relative to the busiest cell in
 * view (a daily commute stays visible next to home), then eased so that only
 * the truly frequent places reach the top of the ramp.
 */
export function heatFeatures(
  cells: readonly (readonly [number, number, number])[],
): GeoJSON.FeatureCollection<GeoJSON.Point, { weight: number }> {
  let max = 1;
  for (const cell of cells) if (cell[2] > max) max = cell[2];
  const scale = Math.log1p(max);
  return {
    type: "FeatureCollection",
    features: cells.map(([lon, lat, count]) => ({
      type: "Feature",
      properties: { weight: (Math.log1p(count) / scale) ** 1.6 },
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  };
}
