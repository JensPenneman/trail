import type { MapPoint } from "./mapTypes";

/** Visit places or scrubber positions as coloured points. */
export function pointFeatures(
  points: readonly MapPoint[],
): GeoJSON.FeatureCollection<GeoJSON.Point, { color: string }> {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      properties: { color: point.color },
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    })),
  };
}
