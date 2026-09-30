import type { DeviceSummary } from "@trail/contracts/device";
import { useFormatter } from "../format/useFormatter";
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
  const low = level !== null && level < 0.2 && state !== "charging";
  const fillWidth = level === null ? 0 : Math.max(1.5, Math.round(level * 15 * 10) / 10);
  return (
    <span className={low ? "battery battery--low" : "battery"}>
      <svg className="battery__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="2.5" y="7" width="17" height="10" rx="2.25" className="battery__case" />
        <path d="M21.5 10.5v3" className="battery__case" />
        {level === null ? null : (
          <rect x="3.5" y="8" width={fillWidth} height="8" rx="1.25" className="battery__fill" />
        )}
        {state === "charging" ? (
          <path d="M11.5 8.5l-2.5 4h3l-1 3" className="battery__bolt" />
        ) : null}
      </svg>
      <span>
        {level === null ? "Battery unknown" : format.percent(level)}
        {stateLabel === null ? null : <span className="battery__state"> · {stateLabel}</span>}
      </span>
    </span>
  );
}
