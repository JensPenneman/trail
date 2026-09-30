import type { GeoJSONSourceSpecification, Map as MapLibreMap } from "maplibre-gl";

export const trailSources = {
  heat: "trail-heat",
  accuracy: "trail-accuracy",
  tracks: "trail-tracks",
  visits: "trail-visits",
  cursors: "trail-cursors",
} as const;

const empty: GeoJSONSourceSpecification = {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
};

/** One hue from transparent to strong, flipped for the dark map so dense means bright. */
const heatRamp = {
  light: [
    0,
    "rgba(61, 61, 178, 0)",
    0.12,
    "rgba(129, 125, 235, 0.35)",
    0.35,
    "rgba(96, 90, 222, 0.58)",
    0.6,
    "rgba(66, 58, 196, 0.76)",
    0.85,
    "rgba(45, 38, 150, 0.88)",
    1,
    "rgba(28, 22, 104, 0.95)",
  ],
  dark: [
    0,
    "rgba(181, 174, 254, 0)",
    0.12,
    "rgba(84, 78, 170, 0.42)",
    0.35,
    "rgba(122, 115, 222, 0.6)",
    0.6,
    "rgba(166, 158, 250, 0.78)",
    0.85,
    "rgba(208, 203, 255, 0.9)",
    1,
    "rgba(246, 244, 255, 0.96)",
  ],
} as const;

/**
 * Adds Trail's sources and layers to the current style (again after every
 * style switch, which drops them). Data layers go below the basemap's labels
 * so street and place names stay readable; visit and scrubber dots go on top.
 */
export function ensureTrailLayers(map: MapLibreMap, dark: boolean): void {
  for (const id of Object.values(trailSources)) {
    if (map.getSource(id) === undefined) map.addSource(id, empty);
  }
  const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  const casing = dark ? "rgba(12, 12, 14, 0.85)" : "rgba(255, 255, 255, 0.95)";
  const surface = dark ? "#1c1e20" : "#ffffff";

  if (map.getLayer("trail-heat") === undefined) {
    map.addLayer(
      {
        id: "trail-heat",
        type: "heatmap",
        source: trailSources.heat,
        paint: {
          "heatmap-weight": ["get", "weight"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 10, 0.8, 16, 1.3],
          "heatmap-radius": [
            "interpolate",
            ["exponential", 1.5],
            ["zoom"],
            2,
            6,
            8,
            12,
            13,
            20,
            18,
            34,
          ],
          "heatmap-opacity": 0.78,
        },
      },
      firstLabel,
    );
  }
  map.setPaintProperty("trail-heat", "heatmap-color", [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    ...(dark ? heatRamp.dark : heatRamp.light),
  ]);

  if (map.getLayer("trail-accuracy-fill") === undefined) {
    map.addLayer(
      {
        id: "trail-accuracy-fill",
        type: "fill",
        source: trailSources.accuracy,
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
      },
      firstLabel,
    );
    map.addLayer(
      {
        id: "trail-accuracy-line",
        type: "line",
        source: trailSources.accuracy,
        paint: { "line-color": ["get", "color"], "line-width": 1.25, "line-opacity": 0.6 },
      },
      firstLabel,
    );
  }

  if (map.getLayer("trail-track-casing") === undefined) {
    map.addLayer(
      {
        id: "trail-track-casing",
        type: "line",
        source: trailSources.tracks,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 7, 18, 10],
        },
      },
      firstLabel,
    );
    map.addLayer(
      {
        id: "trail-track-line",
        type: "line",
        source: trailSources.tracks,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 3.75, 18, 6],
        },
      },
      firstLabel,
    );
  }
  map.setPaintProperty("trail-track-casing", "line-color", casing);

  if (map.getLayer("trail-visits") === undefined) {
    map.addLayer({
      id: "trail-visits",
      type: "circle",
      source: trailSources.visits,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 15, 7],
        "circle-stroke-width": 2.5,
        "circle-stroke-color": ["get", "color"],
      },
    });
  }
  map.setPaintProperty("trail-visits", "circle-color", surface);

  if (map.getLayer("trail-cursors") === undefined) {
    map.addLayer({
      id: "trail-cursors",
      type: "circle",
      source: trailSources.cursors,
      paint: {
        "circle-radius": 8,
        "circle-color": ["get", "color"],
        "circle-stroke-width": 3,
      },
    });
  }
  map.setPaintProperty("trail-cursors", "circle-stroke-color", surface);
}
