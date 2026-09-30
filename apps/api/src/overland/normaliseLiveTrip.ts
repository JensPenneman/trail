import type { StoredLiveTrip } from "../db/schema/devices";
import { asRecord, nonNegativeOrNull } from "./overlandValues";
import { parseOverlandTimestamp } from "./parseOverlandTimestamp";

/** The payload's top-level `trip` (a trip in progress on the phone), or null when absent or unusable. */
export function normaliseLiveTrip(value: unknown): StoredLiveTrip | null {
  const trip = asRecord(value);
  if (trip === null) return null;
  const startedAt = parseOverlandTimestamp(trip["start"]);
  if (startedAt === null) return null;
  return {
    mode: typeof trip["mode"] === "string" ? trip["mode"] : "unknown",
    startedAt: startedAt.toISOString(),
    distanceM: nonNegativeOrNull(trip["distance"]) ?? 0,
  };
}
