/** `[lon, lat]` in degrees. */
type LonLat = readonly [number, number];

const earthRadiusM = 6_371_008.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Farther apart than this, a jump shows on the map (docs/architecture.md
 * §17.6): a stop whose points spread this far (its `spreadM`) is drawn with
 * its path, and a segment that starts this far from where the one before it
 * ended, after its last point, gets a connector to it.
 */
export const visibleGapM = 25;

/** Great-circle distance in metres. */
export function metresBetween(a: LonLat, b: LonLat): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}
