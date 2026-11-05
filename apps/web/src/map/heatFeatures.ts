import { heatClassOf, heatShadeOf } from "./heatScale";
import { cellEdges } from "./heatTiles";
import type { MapHeat } from "./mapTypes";

/** The gap between two neighbouring cells, in CSS pixels at the zoom they are drawn for. */
const gapPx = 1.5;

/**
 * The widest a square is drawn: past map zoom 15 the cells stay at level 20
 * and grow on screen (32 px at zoom 16, 256 at 19), and squares that big would
 * blank whole blocks of the map around the busiest places.
 */
const maxSquarePx = 20;

/** However small the cells, the gap takes at most a fifth of each, so they still show. */
const maxGapShare = 0.2;

/** MapLibre draws the slippy tile of level z 512 px wide at map zoom z. */
const tilePx = 512;

/**
 * The heatmap's cells as squares (docs/architecture.md §14): each cell is the
 * slippy tile `[x, y]` of its level, drawn a little smaller so
 * that a thin gap of the map shows between neighbours, with the ramp step of
 * its count's class. `zoom` is the map's zoom as the cells arrive: there the
 * gap is 1.5 px, and a square at most 20 px wide, centred in its tile — the
 * cells of level 20 grow past zoom 15, their squares do not.
 */
export function heatFeatures(
  heat: MapHeat | null,
  zoom: number,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, { shade: number }> {
  if (heat === null) return { type: "FeatureCollection", features: [] };
  const cellPx = tilePx * 2 ** (zoom - heat.cellZoom);
  const squarePx =
    gapPx > cellPx * maxGapShare
      ? cellPx * (1 - maxGapShare)
      : Math.min(cellPx - gapPx, maxSquarePx);
  // What is left of the tile on each side, as a share of it.
  const inset = (1 - squarePx / cellPx) / 2;
  const classes = heat.scale.starts.length;
  return {
    type: "FeatureCollection",
    features: heat.cells.map(([x, y, value]) => {
      const { west, east, north, south } = cellEdges(x, y, heat.cellZoom, inset);
      return {
        type: "Feature",
        properties: { shade: heatShadeOf(heatClassOf(heat.scale, value), classes) },
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
