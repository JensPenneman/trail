import type { DeviceSummary } from "@trail/contracts/device";

/** Below a fifth and not charging: worth a warning colour. */
export function batteryLow(battery: DeviceSummary["battery"]): boolean {
  const level = battery?.level ?? null;
  return level !== null && level < 0.2 && battery?.state !== "charging";
}
