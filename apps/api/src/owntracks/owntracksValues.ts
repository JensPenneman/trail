import { type BatteryState, finiteOrNull, nonNegativeRealOrNull } from "../ingest/ingestValues";

/** OwnTracks' `tst` and `created_at`: UNIX time in seconds (iOS sends a double). */
export function epochSecondsOf(value: unknown): Date | null {
  const seconds = finiteOrNull(value);
  return seconds === null || seconds <= 0 ? null : new Date(Math.round(seconds * 1000));
}

/* `bs`: 0 unknown, 1 unplugged, 2 charging, 3 full (iOS's UIDeviceBatteryState). */
const batteryStatuses: readonly BatteryState[] = ["unknown", "unplugged", "charging", "full"];

export function batteryStatusOf(value: unknown): BatteryState | null {
  return typeof value === "number" && Number.isInteger(value)
    ? (batteryStatuses[value] ?? null)
    : null;
}

/** `vel` is km/h (both apps round it to a whole number); Trail keeps m/s. */
export function speedOf(value: unknown): number | null {
  const kmh = nonNegativeRealOrNull(value);
  return kmh === null ? null : kmh / 3.6;
}
