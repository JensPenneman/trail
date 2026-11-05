import type { MapTrack } from "./mapTypes";

/**
 * One LineString per continuous segment, carrying its device colour for the line layer
 * and, ahead of the playback cursor, `dimmed`.
 */
export function trackFeatures(
  tracks: readonly MapTrack[],
): GeoJSON.FeatureCollection<GeoJSON.LineString, { color: string; dimmed?: true }> {
  const features: GeoJSON.Feature<GeoJSON.LineString, { color: string; dimmed?: true }>[] = [];
  for (const track of tracks) {
    for (const segment of track.segments) {
      if (segment.length < 2) continue;
      features.push({
        type: "Feature",
        properties:
          track.dimmed === true ? { color: track.color, dimmed: true } : { color: track.color },
        geometry: { type: "LineString", coordinates: segment.map(([lon, lat]) => [lon, lat]) },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
