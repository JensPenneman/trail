import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { dataLayerPlacement } from "../src/map/dataLayerPlacement";
import { ensureTrailLayers } from "../src/map/ensureTrailLayers";
import { asStyleLayers, darkLayers, libertyLayers } from "./support/basemapLayers";

interface FakeLayer {
  id: string;
  type: string;
  layout?: unknown;
}

/** Just enough of a MapLibre map to add, find and move layers in a style's order. */
function fakeMap(layers: FakeLayer[], sources = new Set<string>()) {
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

describe("dataLayerPlacement", () => {
  it("puts the squares above liberty's last shapes, under its names", () => {
    expect(dataLayerPlacement(asStyleLayers(libertyLayers))).toEqual({
      beforeId: "waterway_line_label",
      raise: [],
    });
  });

  it("raises the names the dark style draws under its buildings, roads and boundaries", () => {
    expect(dataLayerPlacement(asStyleLayers(darkLayers))).toEqual({
      beforeId: "place_other",
      raise: ["water_name", "highway_name_other", "highway_name_motorway"],
    });
  });

  it("puts the squares on top of a style without names (satellite, the end-to-end ground)", () => {
    expect(dataLayerPlacement([{ id: "imagery", type: "raster" }])).toEqual({
      beforeId: undefined,
      raise: [],
    });
  });
});

describe("ensureTrailLayers in OpenFreeMap's styles", () => {
  const isTrailShape = (layer: FakeLayer) =>
    layer.id.startsWith("trail-") && (layer.type === "fill" || layer.type === "line");

  for (const [name, style, dark] of [
    ["liberty", libertyLayers, false],
    ["dark", darkLayers, true],
  ] as const) {
    it(`draws every fill and line over every shape and under every name of ${name}`, () => {
      const layers: FakeLayer[] = asStyleLayers(style);
      ensureTrailLayers(fakeMap(layers), dark);

      const trail = layers.flatMap((layer, index) => (isTrailShape(layer) ? [index] : []));
      expect(trail.length).toBeGreaterThan(10);
      const first = Math.min(...trail);
      const last = Math.max(...trail);
      const shapesAbove = layers.filter(
        (layer, index) =>
          index > first && !layer.id.startsWith("trail-") && layer.type !== "symbol",
      );
      const namesBelow = layers.filter((layer, index) => index < last && isText(layer));
      expect(shapesAbove.map((layer) => layer.id)).toEqual([]);
      expect(namesBelow.map((layer) => layer.id)).toEqual([]);
      // Heat stays the lowest of them, circles stay above everything else.
      expect(layers[first]?.id).toBe("trail-heat");
      expect(layers.slice(-3).map((layer) => layer.id)).toEqual([
        "trail-transport-stops",
        "trail-visits",
        "trail-cursors",
      ]);
    });
  }

  it("keeps the order when called again, also with the theme flipped", () => {
    const layers: FakeLayer[] = asStyleLayers(darkLayers);
    const map = fakeMap(layers);
    ensureTrailLayers(map, false);
    const once = layers.map((layer) => layer.id);
    ensureTrailLayers(map, true);
    ensureTrailLayers(map, true);
    expect(layers.map((layer) => layer.id)).toEqual(once);
  });

  it("places everything again after the style is swapped for the other one", () => {
    const layers: FakeLayer[] = asStyleLayers(libertyLayers);
    const sources = new Set<string>();
    const map = fakeMap(layers, sources);
    ensureTrailLayers(map, false);
    // A new style drops Trail's layers and sources; the map object stays.
    layers.splice(0, layers.length, ...asStyleLayers(darkLayers));
    sources.clear();
    ensureTrailLayers(map, true);

    const trail = layers.flatMap((layer, index) => (isTrailShape(layer) ? [index] : []));
    const first = Math.min(...trail);
    const last = Math.max(...trail);
    const shapesAbove = layers.filter(
      (layer, index) => index > first && !layer.id.startsWith("trail-") && layer.type !== "symbol",
    );
    expect(shapesAbove).toEqual([]);
    expect(layers.filter((layer, index) => index < last && isText(layer))).toEqual([]);
    expect(layers.filter((layer) => layer.id === "trail-heat")).toHaveLength(1);
  });

  it("raises the names under the circles when the style ends in a shape", () => {
    const layers: FakeLayer[] = [
      { id: "names", type: "symbol", layout: { "text-field": "{name}" } },
      { id: "ground", type: "fill" },
    ];
    ensureTrailLayers(fakeMap(layers), false);
    expect(layers.at(-1)?.id).toBe("trail-cursors");
    expect(layers.findIndex((layer) => layer.id === "names")).toBeLessThan(
      layers.findIndex((layer) => layer.id === "trail-transport-stops"),
    );
    expect(layers.findIndex((layer) => layer.id === "names")).toBeGreaterThan(
      layers.findIndex((layer) => layer.id === "trail-transport-line"),
    );
  });

  it("puts everything on top of a raster style", () => {
    const layers: FakeLayer[] = [{ id: "imagery", type: "raster" }];
    ensureTrailLayers(fakeMap(layers), false);
    expect(layers[0]?.id).toBe("imagery");
    expect(layers.slice(1).every((layer) => layer.id.startsWith("trail-"))).toBe(true);
    expect(layers[1]?.id).toBe("trail-heat");
  });
});
