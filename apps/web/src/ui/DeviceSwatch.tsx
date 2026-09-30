import "./DeviceSwatch.css";

interface DeviceSwatchProps {
  slot: number;
  /** `line` for track keys, `dot` next to a device name. */
  shape?: "dot" | "line";
}

/** The device's identity colour; always shown next to the device's name. */
export function DeviceSwatch({ slot, shape = "dot" }: DeviceSwatchProps) {
  return (
    <span
      className={`device-swatch device-swatch--${shape} device-color-${slot}`}
      aria-hidden="true"
    />
  );
}
