import type { Bounds } from "./mapTypes";

/** The box around a set of `[lon, lat]` points, or null when there are none. */
export function boundsOf(points: Iterable<readonly [number, number]>): Bounds | null {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of points) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}
