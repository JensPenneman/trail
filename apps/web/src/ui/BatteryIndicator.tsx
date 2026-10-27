import type { DeviceSummary } from "@trail/contracts/device";
import { useFormatter } from "../format/useFormatter";
import { BatteryIcon } from "./BatteryIcon";
import { batteryLow } from "./batteryLow";
import "./BatteryIndicator.css";

interface BatteryIndicatorProps {
  battery: DeviceSummary["battery"];
}

const stateLabels = {
  charging: "charging",
  full: "full",
  unplugged: null,
  unknown: null,
} as const;

/** Battery level of the phone at its last upload, with a drawn gauge and the value as text. */
export function BatteryIndicator({ battery }: BatteryIndicatorProps) {
  const format = useFormatter();
  const level = battery?.level ?? null;
  const state = battery?.state ?? null;
  const stateLabel = state === null ? null : stateLabels[state];
  return (
    <span className={batteryLow(battery) ? "battery battery--low" : "battery"}>
      <BatteryIcon battery={battery} />
      <span>
        {level === null ? "Battery unknown" : format.percent(level)}
        {stateLabel === null ? null : <span className="battery__state"> · {stateLabel}</span>}
      </span>
    </span>
  );
}
