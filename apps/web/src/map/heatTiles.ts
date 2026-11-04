/*
 * The cells of the heatmap are slippy-map tiles (docs/architecture.md §8.2, §14): `[x, y, value]`
 * with x and y the tile of the cell zoom. The corners and the centre of a tile in degrees.
 */

const lonOf = (column: number, tiles: number): number => (column / tiles) * 360 - 180;
const latOf = (row: number, tiles: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / tiles))) * 180) / Math.PI;

/** The edges of the part of tile (x, y) of zoom `z` from `inset` to `1 - inset` of its width and height. */
export function cellEdges(
  x: number,
  y: number,
  z: number,
  inset = 0,
): { west: number; east: number; north: number; south: number } {
  const tiles = 2 ** z;
  return {
    west: lonOf(x + inset, tiles),
    east: lonOf(x + 1 - inset, tiles),
    north: latOf(y + inset, tiles),
    south: latOf(y + 1 - inset, tiles),
  };
}

/** The cells of an answer as places: the `n` with the most (all when `n` is left out), busiest first. */
export function heatPlaces(
  answer: { cells: readonly (readonly [number, number, number])[]; cellZoom: number },
  n = answer.cells.length,
): { lon: number; lat: number; value: number }[] {
  return [...answer.cells]
    .sort((a, b) => b[2] - a[2])
    .slice(0, n)
    .map(([x, y, value]) => {
      const [lon, lat] = cellCentre(x, y, answer.cellZoom);
      return { lon, lat, value };
    });
}

/** The centre `[lon, lat]` of tile (x, y) of zoom `z`. */
export function cellCentre(x: number, y: number, z: number): [number, number] {
  const tiles = 2 ** z;
  return [lonOf(x + 0.5, tiles), latOf(y + 0.5, tiles)];
}
