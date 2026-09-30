import { asRecord } from "./overlandValues";

/** Upper bound on records per upload; Overland's largest batch setting is 1000. */
const maxRecords = 5000;

export interface OverlandPayload {
  locations: unknown[];
  current?: unknown;
  trip?: unknown;
}

/**
 * Shown on the phone when the body is not Overland's JSON — most often because
 * the app is in OwnTracks mode, which sends a single object.
 */
export const payloadShapeError =
  'Expected Overland JSON with a "locations" array. In Overland set Logging Mode to “All Data”.';

export function isOverlandPayload(body: unknown): body is OverlandPayload {
  const payload = asRecord(body);
  if (payload === null) return false;
  const records = payload["locations"];
  return Array.isArray(records) && records.length <= maxRecords;
}
