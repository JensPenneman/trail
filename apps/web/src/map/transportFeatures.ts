import { visibleGapM } from "./lineGeometry";
import type { MapTransportSegment } from "./mapTypes";

interface TransportProperties {
  id: string;
  selectable: boolean;
  color: string;
  review: boolean;
}

/** Whether a stop is drawn with its path: its points spread farther than a jump that shows. */
export const showsPath = (segment: MapTransportSegment): boolean =>
  segment.kind === "stop" && segment.line.length > 1 && (segment.spreadM ?? 0) > visibleGapM;

const lineOf = (segment: MapTransportSegment): GeoJSON.LineString => ({
  type: "LineString",
  coordinates: segment.line.map(([lon, lat]) => [lon, lat]),
});

/**
 * Moves (and pieces of track) as lines; stops as dots at their place, and as
 * dotted lines where their points spread (the walk within a station);
 * connectors across recording gaps as dashed lines. Each feature carries its
 * colour and id.
 */
export function transportFeatures(segments: readonly MapTransportSegment[]): {
  lines: GeoJSON.FeatureCollection<GeoJSON.LineString, TransportProperties>;
  stops: GeoJSON.FeatureCollection<GeoJSON.Point, TransportProperties>;
  stopPaths: GeoJSON.FeatureCollection<GeoJSON.LineString, TransportProperties>;
  gaps: GeoJSON.FeatureCollection<GeoJSON.LineString, TransportProperties>;
} {
  const lines: GeoJSON.Feature<GeoJSON.LineString, TransportProperties>[] = [];
  const stops: GeoJSON.Feature<GeoJSON.Point, TransportProperties>[] = [];
  const stopPaths: GeoJSON.Feature<GeoJSON.LineString, TransportProperties>[] = [];
  const gaps: GeoJSON.Feature<GeoJSON.LineString, TransportProperties>[] = [];
  for (const segment of segments) {
    const properties = {
      id: segment.id,
      selectable: segment.selectable,
      color: segment.color,
      review: segment.review,
    };
    if (segment.kind === "stop") {
      const place = segment.place ?? segment.line[0];
      if (place !== undefined) {
        stops.push({
          type: "Feature",
          properties,
          geometry: { type: "Point", coordinates: [place[0], place[1]] },
        });
      }
      if (showsPath(segment)) {
        stopPaths.push({ type: "Feature", properties, geometry: lineOf(segment) });
      }
      continue;
    }
    if (segment.line.length < 2) continue;
    (segment.kind === "gap" ? gaps : lines).push({
      type: "Feature",
      properties,
      geometry: lineOf(segment),
    });
  }
  const collection = <G extends GeoJSON.Geometry>(
    features: GeoJSON.Feature<G, TransportProperties>[],
  ): GeoJSON.FeatureCollection<G, TransportProperties> => ({ type: "FeatureCollection", features });
  return {
    lines: collection(lines),
    stops: collection(stops),
    stopPaths: collection(stopPaths),
    gaps: collection(gaps),
  };
}
