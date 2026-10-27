import { heatClassOf, heatShadeOf } from "./heatScale";
import type { MapHeat } from "./mapTypes";

/** The gap between two neighbouring cells, in CSS pixels at the zoom they are drawn for. */
const gapPx = 1.5;

/** MapLibre draws the slippy tile of level z 512 px wide at map zoom z. */
const tilePx = 512;

const lonOf = (column: number, tiles: number) => (column / tiles) * 360 - 180;
const latOf = (row: number, tiles: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / tiles))) * 180) / Math.PI;

/**
 * The heatmap's cells as squares (docs/architecture.md §14): each cell is the
 * slippy tile of its level that holds its centre, drawn a little smaller so
 * that a thin gap of the map shows between neighbours, with the ramp step of
 * its count's class. `zoom` is the map's zoom as the cells arrive: the gap is
 * 1.5 px there, also for the finest cells, which grow on screen past zoom 13.
 */
export function heatFeatures(
  heat: MapHeat | null,
  zoom: number,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, { shade: number }> {
  if (heat === null) return { type: "FeatureCollection", features: [] };
  const tiles = 2 ** heat.cellZoom;
  const cellPx = tilePx * 2 ** (zoom - heat.cellZoom);
  // Never more than a fifth of a cell, so that cells far smaller than meant still show.
  const inset = Math.min(0.2, gapPx / cellPx) / 2;
  const classes = heat.scale.starts.length;
  return {
    type: "FeatureCollection",
    features: heat.cells.map(([lon, lat, count]) => {
      const x = Math.floor(((lon + 180) / 360) * tiles);
      const radians = (lat * Math.PI) / 180;
      const y = Math.floor(
        ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * tiles,
      );
      const west = lonOf(x + inset, tiles);
      const east = lonOf(x + 1 - inset, tiles);
      const north = latOf(y + inset, tiles);
      const south = latOf(y + 1 - inset, tiles);
      return {
        type: "Feature",
        properties: { shade: heatShadeOf(heatClassOf(heat.scale, count), classes) },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [west, north],
              [east, north],
              [east, south],
              [west, south],
              [west, north],
            ],
          ],
        },
      };
    }),
  };
}
