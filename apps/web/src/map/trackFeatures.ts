import type { MapTrack } from "./mapTypes";

/** One LineString per continuous segment, carrying its device colour for the line layer. */
export function trackFeatures(
  tracks: readonly MapTrack[],
): GeoJSON.FeatureCollection<GeoJSON.LineString, { color: string }> {
  const features: GeoJSON.Feature<GeoJSON.LineString, { color: string }>[] = [];
  for (const track of tracks) {
    for (const segment of track.segments) {
      if (segment.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { color: track.color },
        geometry: { type: "LineString", coordinates: segment.map(([lon, lat]) => [lon, lat]) },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
