import "./DeviceSwatch.css";

interface DeviceSwatchProps {
  slot: number;
  /** `line` for track keys, `dot` next to a device name. */
  shape?: "dot" | "line";
  /** Someone else's device is drawn in their colour, from the people's palette. */
  palette?: "device" | "person";
}

/** The device's identity colour; always shown next to the device's name. */
export function DeviceSwatch({ slot, shape = "dot", palette = "device" }: DeviceSwatchProps) {
  return (
    <span
      className={`device-swatch device-swatch--${shape} ${palette}-color-${slot}${palette === "person" ? " device-swatch--person" : ""}`}
      aria-hidden="true"
    />
  );
}
