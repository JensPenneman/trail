import type { DeviceSummary } from "@trail/contracts/device";

interface BatteryIconProps {
  battery: DeviceSummary["battery"];
  /** What it says on its own (`BatteryGlyph`); without one it is decoration beside its text. */
  label?: string;
}

/** The drawn gauge of a phone's battery: its case, the level as a fill, a bolt while charging. */
export function BatteryIcon({ battery, label }: BatteryIconProps) {
  const level = battery?.level ?? null;
  const fillWidth = level === null ? 0 : Math.max(1.5, Math.round(level * 15 * 10) / 10);
  return (
    <svg
      className="battery__icon"
      viewBox="0 0 24 24"
      focusable="false"
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
    >
      {label === undefined ? null : <title>{label}</title>}
      <rect x="2.5" y="7" width="17" height="10" rx="2.25" className="battery__case" />
      <path d="M21.5 10.5v3" className="battery__case" />
      {level === null ? null : (
        <rect x="3.5" y="8" width={fillWidth} height="8" rx="1.25" className="battery__fill" />
      )}
      {battery?.state === "charging" ? (
        <path d="M11.5 8.5l-2.5 4h3l-1 3" className="battery__bolt" />
      ) : null}
    </svg>
  );
}
