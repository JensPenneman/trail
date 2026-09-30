import { batteryStates } from "@trail/contracts/device";

export type BatteryState = (typeof batteryStates)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A plain JSON object, or null for anything else (arrays, primitives, null). */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Overland marks invalid readings with negative numbers (speed, course, accuracies, battery). */
export function nonNegativeOrNull(value: unknown): number | null {
  const number = finiteOrNull(value);
  return number !== null && number >= 0 ? number : null;
}

/** Battery level 0..1; −1 (unknown) and anything out of range become null. */
export function batteryLevelOf(value: unknown): number | null {
  const level = nonNegativeOrNull(value);
  return level !== null && level <= 1 ? level : null;
}

export function batteryStateOf(value: unknown): BatteryState | null {
  return batteryStates.find((state) => state === value) ?? null;
}

/** Wi-Fi SSID; Overland sends an empty string when not on Wi-Fi. */
export function wifiOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function stringArrayOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** Every property that has no column of its own, so nothing the phone sent is lost. */
export function extraOf(
  properties: Record<string, unknown>,
  mapped: ReadonlySet<string>,
): Record<string, unknown> | null {
  const extra = Object.fromEntries(Object.entries(properties).filter(([key]) => !mapped.has(key)));
  return Object.keys(extra).length > 0 ? extra : null;
}
