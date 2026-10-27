export type CoordinatesResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: string };

/** A plausible position in WGS84 degrees; (0, 0) is a GPS failure, not a place. */
export function checkCoordinates(lat: number | null, lon: number | null): CoordinatesResult {
  if (lat === null || lon === null) return { ok: false, reason: "invalid coordinates" };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, reason: "coordinates out of range" };
  }
  if (lat === 0 && lon === 0) return { ok: false, reason: "coordinates are exactly 0,0" };
  return { ok: true, lat, lon };
}
