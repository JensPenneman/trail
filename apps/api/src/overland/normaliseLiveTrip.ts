import type { StoredLiveTrip } from "../db/schema/devices";
import { asRecord, nonNegativeOrNull, textOrNull } from "./overlandValues";
import { recordTime } from "./recordTime";

/** The payload's top-level `trip` (a trip in progress on the phone), or null when absent or unusable. */
export function normaliseLiveTrip(value: unknown, receivedAt: Date): StoredLiveTrip | null {
  const trip = asRecord(value);
  if (trip === null) return null;
  const startedAt = recordTime(trip["start"], receivedAt);
  if (!startedAt.ok) return null;
  return {
    mode: textOrNull(trip["mode"]) ?? "unknown",
    startedAt: startedAt.value.toISOString(),
    distanceM: nonNegativeOrNull(trip["distance"]) ?? 0,
  };
}
