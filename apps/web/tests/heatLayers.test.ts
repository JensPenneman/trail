import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { ensureTrailLayers } from "../src/map/ensureTrailLayers";
import { heatLayerPlacement } from "../src/map/heatLayerPlacement";
import { asStyleLayers, darkLayers, libertyLayers } from "./support/basemapLayers";

interface FakeLayer {
  id: string;
  type: string;
  layout?: unknown;
}

/** Just enough of a MapLibre map to add, find and move layers in a style's order. */
function fakeMap(layers: FakeLayer[]) {
  const sources = new Set<string>();
  const indexOf = (id: string | undefined) =>
    id === undefined ? layers.length : layers.findIndex((layer) => layer.id === id);
  const map = {
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addSource: (id: string) => sources.add(id),
    getStyle: () => ({ layers: [...layers] }),
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    addLayer: (layer: FakeLayer, beforeId?: string) => {
      layers.splice(indexOf(beforeId), 0, layer);
    },
    moveLayer: (id: string, beforeId?: string) => {
      const [layer] = layers.splice(indexOf(id), 1);
      if (layer !== undefined) layers.splice(indexOf(beforeId), 0, layer);
    },
    setPaintProperty: () => undefined,
    setFilter: () => undefined,
  };
  return map as unknown as MapLibreMap;
}

const isText = (layer: FakeLayer) =>
  layer.type === "symbol" &&
  typeof layer.layout === "object" &&
  layer.layout !== null &&
  "text-field" in layer.layout;

describe("heatLayerPlacement", () => {
  it("puts the squares above liberty's last shapes, under its names", () => {
    expect(heatLayerPlacement(asStyleLayers(libertyLayers))).toEqual({
      beforeId: "waterway_line_label",
      raise: [],
    });
  });

  it("raises the names the dark style draws under its buildings, roads and boundaries", () => {
    expect(heatLayerPlacement(asStyleLayers(darkLayers))).toEqual({
      beforeId: "place_other",
      raise: ["water_name", "highway_name_other", "highway_name_motorway"],
    });
  });

  it("puts the squares on top of a style without names (satellite, the end-to-end ground)", () => {
    expect(heatLayerPlacement([{ id: "imagery", type: "raster" }])).toEqual({
      beforeId: undefined,
      raise: [],
    });
  });
});

describe("ensureTrailLayers in OpenFreeMap's styles", () => {
  for (const [name, style, dark] of [
    ["liberty", libertyLayers, false],
    ["dark", darkLayers, true],
  ] as const) {
    it(`draws the squares over every shape and under every name of ${name}`, () => {
      const layers: FakeLayer[] = asStyleLayers(style);
      const firstLabel = layers.find((layer) => layer.type === "symbol")?.id;
      const belowFirstLabel = layers.slice(
        0,
        layers.findIndex((layer) => layer.id === firstLabel),
      );
      ensureTrailLayers(fakeMap(layers), dark);

      const heat = layers.findIndex((layer) => layer.id === "trail-heat");
      const basemap = layers.map((layer, index) => ({ layer, index }));
      const shapesAbove = basemap.filter(
        ({ layer, index }) =>
          index > heat && !layer.id.startsWith("trail-") && layer.type !== "symbol",
      );
      const namesBelow = basemap.filter(({ layer, index }) => index < heat && isText(layer));
      expect(shapesAbove.map(({ layer }) => layer.id)).toEqual([]);
      expect(namesBelow.map(({ layer }) => layer.id)).toEqual([]);

      // Trail's lines stay where they were: under the style's first symbol, over the same shapes.
      const track = layers.findIndex((layer) => layer.id === "trail-track-line");
      expect(layers.slice(0, track).filter((layer) => !layer.id.startsWith("trail-"))).toEqual(
        belowFirstLabel,
      );
    });
  }
});
