import { type BatteryState, batteryLevelOf, batteryStateOf } from "./overlandValues";

/** Battery metadata carried by every Overland record. */
export interface BatteryReading {
  recordedAt: Date;
  level: number | null;
  state: BatteryState | null;
}

/** The battery reading of a record's properties, or null when it carries none. */
export function batteryReading(
  properties: Record<string, unknown>,
  recordedAt: Date,
): BatteryReading | null {
  const level = batteryLevelOf(properties["battery_level"]);
  const state = batteryStateOf(properties["battery_state"]);
  if (level === null && state === null) return null;
  return { recordedAt, level, state };
}
