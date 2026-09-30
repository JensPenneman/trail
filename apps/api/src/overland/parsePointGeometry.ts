import { asRecord, finiteOrNull } from "./overlandValues";

export type GeometryResult = { ok: true; lat: number; lon: number } | { ok: false; reason: string };

/** A GeoJSON Point with a plausible position; (0, 0) is a GPS failure, not a place. */
export function parsePointGeometry(value: unknown): GeometryResult {
  if (value === undefined || value === null) return { ok: false, reason: "missing geometry" };
  const geometry = asRecord(value);
  if (geometry === null) return { ok: false, reason: "geometry is not an object" };
  if (geometry["type"] !== undefined && geometry["type"] !== "Point") {
    return { ok: false, reason: "geometry is not a Point" };
  }
  const coordinates = geometry["coordinates"];
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return { ok: false, reason: "invalid coordinates" };
  }
  const lon = finiteOrNull(coordinates[0]);
  const lat = finiteOrNull(coordinates[1]);
  if (lon === null || lat === null) return { ok: false, reason: "invalid coordinates" };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, reason: "coordinates out of range" };
  }
  if (lat === 0 && lon === 0) return { ok: false, reason: "coordinates are exactly 0,0" };
  return { ok: true, lat, lon };
}
