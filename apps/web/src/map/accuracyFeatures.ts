import { circleRing } from "./circleRing";
import type { MapPosition } from "./mapTypes";

/** Past this the "position" is a guess across a city; the circle would only hide the map. */
const maxDrawnAccuracyM = 5000;

/** Accuracy circles around the latest positions. */
export function accuracyFeatures(
  positions: readonly MapPosition[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon, { color: string }> {
  return {
    type: "FeatureCollection",
    features: positions
      .filter((position) => position.accuracy !== null && position.accuracy > 0)
      .map((position) => ({
        type: "Feature",
        properties: { color: position.color },
        geometry: {
          type: "Polygon",
          coordinates: [
            circleRing(
              position.lon,
              position.lat,
              Math.min(position.accuracy ?? 0, maxDrawnAccuracyM),
            ),
          ],
        },
      })),
  };
}
