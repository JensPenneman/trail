/** A layer of a style as `map.getStyle().layers` lists it: what placing the heatmap needs. */
interface StyleLayer {
  id: string;
  type: string;
  layout?: unknown;
}

const showsText = (layer: StyleLayer): boolean =>
  layer.type === "symbol" &&
  typeof layer.layout === "object" &&
  layer.layout !== null &&
  "text-field" in layer.layout;

/**
 * Where the heatmap's squares go in a style (docs/architecture.md §14): over
 * every area, road, building and boundary, which would cut the squares apart,
 * and under every name. `beforeId` is the layer to add them below — the first
 * of the symbols after the style's last layer that is not one (none: on top);
 * `raise` the names a style draws earlier, to be moved over the squares in
 * their order (OpenFreeMap's dark style draws its water names under its
 * buildings and its road names under its boundaries). Trail's own layers are
 * left out.
 */
export function heatLayerPlacement(layers: readonly StyleLayer[]): {
  beforeId: string | undefined;
  raise: string[];
} {
  const basemap = layers.filter((layer) => !layer.id.startsWith("trail-"));
  let lastShape = -1;
  for (const [index, layer] of basemap.entries()) {
    if (layer.type !== "symbol") lastShape = index;
  }
  return {
    beforeId: basemap[lastShape + 1]?.id,
    raise: basemap
      .filter((layer, index) => index < lastShape && showsText(layer))
      .map((layer) => layer.id),
  };
}
