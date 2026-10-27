import type {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { heatLayerPlacement } from "./heatLayerPlacement";
import { heatRamp } from "./heatRamp";

export const trailSources = {
  heat: "trail-heat",
  accuracy: "trail-accuracy",
  tracks: "trail-tracks",
  transport: "trail-transport",
  transportStops: "trail-transport-stops",
  visits: "trail-visits",
  cursors: "trail-cursors",
} as const;

/** The layers a click opens a segment from. */
export const transportLayers = ["trail-transport-line", "trail-transport-stops"] as const;

const empty: GeoJSONSourceSpecification = {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
};

/** A square's colour: the step of the ramp its `shade` (1–6) names, for a dark or a light map. */
function heatColor(dark: boolean): ExpressionSpecification {
  const ramp = dark ? heatRamp.dark : heatRamp.light;
  return [
    "step",
    ["get", "shade"],
    ramp[0],
    2,
    ramp[1],
    3,
    ramp[2],
    4,
    ramp[3],
    5,
    ramp[4],
    6,
    ramp[5],
  ];
}

/**
 * Adds Trail's sources and layers to the current style (again after every
 * style switch, which drops them). Data layers go below the basemap's labels
 * so street and place names stay readable; visit and scrubber dots go on top.
 */
export function ensureTrailLayers(map: MapLibreMap, dark: boolean): void {
  for (const id of Object.values(trailSources)) {
    if (map.getSource(id) === undefined) map.addSource(id, empty);
  }
  const styleLayers = map.getStyle().layers;
  const firstLabel = styleLayers.find((layer) => layer.type === "symbol")?.id;
  const casing = dark ? "rgba(12, 12, 14, 0.85)" : "rgba(255, 255, 255, 0.95)";
  const surface = dark ? "#1c1e20" : "#ffffff";

  const heat = heatLayerPlacement(styleLayers);
  const heatAdded = map.getLayer("trail-heat") === undefined;
  if (heatAdded) {
    // Opaque: a square is exactly its colour in the key, and the ramp's contrast its own.
    map.addLayer({ id: "trail-heat", type: "fill", source: trailSources.heat }, heat.beforeId);
  }
  map.setPaintProperty("trail-heat", "fill-color", heatColor(dark));

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

  // Transport: lines in their mode's colour on a casing, a dashed outline over moves to review,
  // the selected segment drawn wider, and stops as dots.
  if (map.getLayer("trail-transport-casing") === undefined) {
    map.addLayer(
      {
        id: "trail-transport-casing",
        type: "line",
        source: trailSources.transport,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4.5, 14, 7.5, 18, 11],
        },
      },
      firstLabel,
    );
    map.addLayer(
      {
        id: "trail-transport-line",
        type: "line",
        source: trailSources.transport,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.25, 14, 4, 18, 6.5],
        },
      },
      firstLabel,
    );
    map.addLayer(
      {
        id: "trail-transport-review",
        type: "line",
        source: trailSources.transport,
        filter: ["==", ["get", "review"], true],
        layout: { "line-join": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 14, 1.5, 18, 2.25],
          "line-dasharray": [2, 2],
          "line-gap-width": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 6, 18, 9],
        },
      },
      firstLabel,
    );
    map.addLayer(
      {
        id: "trail-transport-selected",
        type: "line",
        source: trailSources.transport,
        filter: ["==", ["get", "id"], ""],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 5, 14, 8, 18, 12],
        },
      },
      firstLabel,
    );
  }
  map.setPaintProperty("trail-transport-casing", "line-color", casing);
  map.setPaintProperty("trail-transport-review", "line-color", dark ? "#f2f0ed" : "#1d1b19");

  if (map.getLayer("trail-transport-stops") === undefined) {
    map.addLayer({
      id: "trail-transport-stops",
      type: "circle",
      source: trailSources.transportStops,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 15, 6.5],
        "circle-color": ["get", "color"],
        "circle-stroke-width": 2,
      },
    });
  }
  map.setPaintProperty("trail-transport-stops", "circle-stroke-color", surface);

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

  // Last, once Trail's other layers are in under the first label: the names a style draws
  // under its roads and boundaries go over the squares.
  if (heatAdded) for (const id of heat.raise) map.moveLayer(id, heat.beforeId);
}
