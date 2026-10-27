import type { StyleSpecification } from "maplibre-gl";

const entities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * A MapLibre style of one raster tile layer (satellite imagery from a tile
 * URL template). MapLibre writes attributions into the page as HTML, so the
 * operator's plain-text credit is escaped first. 256 px tiles up to zoom 19,
 * the map's own limit, as XYZ imagery servers serve them.
 */
export function rasterStyle(tiles: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      imagery: {
        type: "raster",
        tiles: [tiles],
        tileSize: 256,
        maxzoom: 19,
        attribution: attribution.replace(/[&<>"']/g, (character) => entities[character] ?? ""),
      },
    },
    layers: [{ id: "imagery", type: "raster", source: "imagery" }],
  };
}
