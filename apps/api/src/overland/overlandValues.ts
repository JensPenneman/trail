import { batteryStates } from "@trail/contracts/device";
import { storableJson } from "./storableJson";
import { storableText } from "./storableText";

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

/* Readings go into `real` (float4) columns, which take only float4's normal range:
 * a larger number overflows and a smaller non-zero one underflows in Postgres,
 * failing the whole upload. Such a reading is garbage anyway. */
const realMax = 3.4028234663852886e38;
const realMinNormal = 1.1754943508222875e-38;

/** A reading for a `real` column, or null when it is not a number Postgres can store there. */
export function realOrNull(value: unknown): number | null {
  const number = finiteOrNull(value);
  if (number === null) return null;
  const magnitude = Math.abs(number);
  return magnitude === 0 || (magnitude >= realMinNormal && magnitude <= realMax) ? number : null;
}

/** `nonNegativeOrNull` for a `real` column. */
export function nonNegativeRealOrNull(value: unknown): number | null {
  const number = realOrNull(value);
  return number !== null && number >= 0 ? number : null;
}

const int4Max = 2_147_483_647;

/** A non-negative whole number for an `integer` column (rounded), or null beyond its range. */
export function countOrNull(value: unknown): number | null {
  const number = nonNegativeOrNull(value);
  if (number === null) return null;
  const rounded = Math.round(number);
  return rounded <= int4Max ? rounded : null;
}

/** Battery level 0..1; −1 (unknown) and anything out of range become null. */
export function batteryLevelOf(value: unknown): number | null {
  const level = nonNegativeRealOrNull(value);
  return level !== null && level <= 1 ? level : null;
}

export function batteryStateOf(value: unknown): BatteryState | null {
  return batteryStates.find((state) => state === value) ?? null;
}

/** Text the phone sent, storable, or null when it is not a string or nothing is left of it. */
export function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = storableText(value);
  return text.trim() === "" ? null : text;
}

/** Wi-Fi SSID; Overland sends an empty string when not on Wi-Fi. */
export function wifiOf(value: unknown): string | null {
  return textOrNull(value);
}

export function stringArrayOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map(storableText)
    : [];
}

/** Every property that has no column of its own, so nothing the phone sent is lost. */
export function extraOf(
  properties: Record<string, unknown>,
  mapped: ReadonlySet<string>,
): Record<string, unknown> | null {
  const extra = Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => !mapped.has(key))
      .map(([key, value]) => [storableText(key), storableJson(value, 1)]),
  );
  return Object.keys(extra).length > 0 ? extra : null;
}
