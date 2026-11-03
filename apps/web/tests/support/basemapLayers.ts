/**
 * The layers of the two basemap styles, in their order: the files the API
 * serves (apps/api/map/styles, OpenFreeMap's `liberty` for Light and `dark`
 * for Dark), so the tests of where Trail's layers go and the styles cannot
 * drift apart. Each layer's id, its type and, for a symbol, whether it shows
 * text.
 */
import darkStyle from "../../../api/map/styles/dark.json";
import libertyStyle from "../../../api/map/styles/liberty.json";

type Layer = readonly [id: string, type: string, text?: "text"];

interface StyleLayer {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
}

const layersOf = (style: { layers: readonly StyleLayer[] }): readonly Layer[] =>
  style.layers.map((layer) =>
    layer.type === "symbol" && layer.layout !== undefined && "text-field" in layer.layout
      ? ([layer.id, layer.type, "text"] as const)
      : ([layer.id, layer.type] as const),
  );

export const libertyLayers = layersOf(libertyStyle as { layers: readonly StyleLayer[] });

export const darkLayers = layersOf(darkStyle as { layers: readonly StyleLayer[] });

/** The layers as MapLibre lists them: a symbol with text has a `text-field`. */
export const asStyleLayers = (layers: readonly Layer[]) =>
  layers.map(([id, type, text]) => ({
    id,
    type,
    layout: text === undefined ? {} : { "text-field": ["get", "name"] },
  }));
