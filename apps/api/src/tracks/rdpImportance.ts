const earthRadiusM = 6_371_008.8;

/** Distance from (px, py) to the segment (ax, ay)–(bx, by), all in metres. */
function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ramer–Douglas–Peucker "importance" of every point of one segment: the
 * largest tolerance (metres) at which the point survives simplification. End
 * points are always kept (Infinity). A point survives tolerance ε exactly when
 * its importance is > ε, so one pass serves every tolerance.
 *
 * Positions are projected equirectangularly around the segment's mean
 * latitude — accurate to well under a percent at track scale.
 */
export function rdpImportance(
  points: ReadonlyArray<readonly [number, number, ...unknown[]]>,
): Float64Array {
  const count = points.length;
  const importance = new Float64Array(count);
  if (count === 0) return importance;
  importance[0] = Number.POSITIVE_INFINITY;
  importance[count - 1] = Number.POSITIVE_INFINITY;
  if (count < 3) return importance;

  let latitudeSum = 0;
  for (const point of points) latitudeSum += point[1];
  const cosLatitude = Math.cos(((latitudeSum / count) * Math.PI) / 180);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    xs[index] = ((earthRadiusM * point[0] * Math.PI) / 180) * cosLatitude;
    ys[index] = (earthRadiusM * point[1] * Math.PI) / 180;
  }

  // Iterative splitting (no recursion depth limit for long segments).
  const stack: Array<[first: number, last: number, ceiling: number]> = [
    [0, count - 1, Number.POSITIVE_INFINITY],
  ];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [first, last, ceiling] = item;
    if (last - first < 2) continue;
    const ax = xs[first] ?? 0;
    const ay = ys[first] ?? 0;
    const bx = xs[last] ?? 0;
    const by = ys[last] ?? 0;
    let farthest = -1;
    let farthestDistance = 0;
    for (let index = first + 1; index < last; index += 1) {
      const distance = segmentDistance(xs[index] ?? 0, ys[index] ?? 0, ax, ay, bx, by);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = index;
      }
    }
    // All interior points on the line: they keep importance 0 and never survive.
    if (farthest < 0) continue;
    // A point can only survive while the split that created its range survives.
    const value = Math.min(farthestDistance, ceiling);
    importance[farthest] = value;
    stack.push([first, farthest, value], [farthest, last, value]);
  }
  return importance;
}
