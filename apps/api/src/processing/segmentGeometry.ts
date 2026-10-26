/** Where a point projects onto the segment a–b: the parameter `t` in [0, 1] and the squared distance. */
export interface SegmentProjection {
  t: number;
  x: number;
  y: number;
  distanceSquared: number;
}

/** The point of segment (ax, ay)–(bx, by) nearest to (px, py), in metres. */
export function projectOntoSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): SegmentProjection {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { t, x, y, distanceSquared: (px - x) ** 2 + (py - y) ** 2 };
}
