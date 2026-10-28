import { type CoordinatesResult, checkCoordinates } from "../ingest/checkCoordinates";
import { asRecord, finiteOrNull } from "../ingest/ingestValues";

export type GeometryResult = CoordinatesResult;

/** A GeoJSON Point with a plausible position. */
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
  return checkCoordinates(finiteOrNull(coordinates[1]), finiteOrNull(coordinates[0]));
}
