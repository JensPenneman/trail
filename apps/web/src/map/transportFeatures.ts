import type { MapTransportSegment } from "./mapTypes";

interface TransportProperties {
  id: string;
  selectable: boolean;
  color: string;
  review: boolean;
}

/** Moves (and pieces of track) as lines, stops as points, each carrying its colour and id. */
export function transportFeatures(segments: readonly MapTransportSegment[]): {
  lines: GeoJSON.FeatureCollection<GeoJSON.LineString, TransportProperties>;
  stops: GeoJSON.FeatureCollection<GeoJSON.Point, TransportProperties>;
} {
  const lines: GeoJSON.Feature<GeoJSON.LineString, TransportProperties>[] = [];
  const stops: GeoJSON.Feature<GeoJSON.Point, TransportProperties>[] = [];
  for (const segment of segments) {
    const properties = {
      id: segment.id,
      selectable: segment.selectable,
      color: segment.color,
      review: segment.review,
    };
    const first = segment.line[0];
    if (segment.kind === "stop") {
      if (first !== undefined) {
        stops.push({
          type: "Feature",
          properties,
          geometry: { type: "Point", coordinates: [first[0], first[1]] },
        });
      }
      continue;
    }
    if (segment.line.length < 2) continue;
    lines.push({
      type: "Feature",
      properties,
      geometry: { type: "LineString", coordinates: segment.line.map(([lon, lat]) => [lon, lat]) },
    });
  }
  return {
    lines: { type: "FeatureCollection", features: lines },
    stops: { type: "FeatureCollection", features: stops },
  };
}
