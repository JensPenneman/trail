/**
 * Visits every cell of a square grid that the segment a–b passes through
 * (Amanatides & Woo): `cellSize` units a side, cells numbered from the
 * origin. The way index walks its 100 m grid with it, the map data loader
 * the z14 tiles in tile units. A segment visits at most
 * |Δcx| + |Δcy| + 2 cells.
 */
export function forEachCell(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cellSize: number,
  visit: (cx: number, cy: number) => void,
): void {
  let cx = Math.floor(ax / cellSize);
  let cy = Math.floor(ay / cellSize);
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : cellSize / Math.abs(dx);
  const deltaY = stepY === 0 ? Number.POSITIVE_INFINITY : cellSize / Math.abs(dy);
  let maxX =
    stepX > 0
      ? ((cx + 1) * cellSize - ax) / dx
      : stepX < 0
        ? (cx * cellSize - ax) / dx
        : Number.POSITIVE_INFINITY;
  let maxY =
    stepY > 0
      ? ((cy + 1) * cellSize - ay) / dy
      : stepY < 0
        ? (cy * cellSize - ay) / dy
        : Number.POSITIVE_INFINITY;
  visit(cx, cy);
  while (Math.min(maxX, maxY) <= 1) {
    if (maxX < maxY) {
      cx += stepX;
      maxX += deltaX;
    } else {
      cy += stepY;
      maxY += deltaY;
    }
    visit(cx, cy);
  }
  const endX = Math.floor(bx / cellSize);
  const endY = Math.floor(by / cellSize);
  if (endX !== cx || endY !== cy) visit(endX, endY);
}
