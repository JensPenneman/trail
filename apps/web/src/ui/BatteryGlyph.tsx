import type { DeviceSummary } from "@trail/contracts/device";
import { useFormatter } from "../format/useFormatter";
import { BatteryIcon } from "./BatteryIcon";
import { batteryLow } from "./batteryLow";
import "./BatteryIndicator.css";

/**
 * A battery as a small glyph alone, for a line with no room for its number:
 * the gauge shows the level, red when low, and its name says it in words
 * ("Battery 58%, charging") to a screen reader and on hover.
 */
export function BatteryGlyph({ battery }: { battery: DeviceSummary["battery"] }) {
  const format = useFormatter();
  const level = battery?.level ?? null;
  const state = battery?.state ?? null;
  const label = `Battery ${level === null ? "unknown" : format.percent(level)}${
    state === "charging" ? ", charging" : state === "full" ? ", full" : ""
  }`;
  return (
    <span className={batteryLow(battery) ? "battery battery--low" : "battery"}>
      <BatteryIcon battery={battery} label={label} />
    </span>
  );
}
