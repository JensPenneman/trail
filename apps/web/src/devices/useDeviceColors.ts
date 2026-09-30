import { useMemo } from "react";
import { useDevices } from "../queries/useDevices";
import { usePrefersDark } from "../ui/usePrefersDark";
import { assignDeviceColors } from "./assignDeviceColors";
import { devicePalette } from "./devicePalette";

export interface DeviceColors {
  /** Palette slot for the CSS class `device-color-<slot>`. */
  slot(deviceId: string): number;
  /** The colour as hex for the current colour scheme (for the map). */
  hex(deviceId: string): string;
}

export function useDeviceColors(): DeviceColors {
  const { data: devices } = useDevices();
  const dark = usePrefersDark();
  return useMemo(() => {
    const slots = assignDeviceColors(devices ?? []);
    const palette = dark ? devicePalette.dark : devicePalette.light;
    const slot = (deviceId: string): number => slots.get(deviceId) ?? 0;
    return { slot, hex: (deviceId) => palette[slot(deviceId)] ?? palette[0] };
  }, [devices, dark]);
}
