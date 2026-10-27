import { useMemo } from "react";
import { useDevices } from "../queries/useDevices";
import { usePrefersDark } from "../ui/usePrefersDark";
import { assignDeviceColors } from "./assignDeviceColors";
import { devicePalette } from "./devicePalette";

export interface DeviceColors {
  /** Palette slot for the CSS class `device-color-<slot>`. */
  slot(deviceId: string): number;
  /** The colour as hex (for the map), in the step for a dark or a light background. */
  hex(deviceId: string): string;
}

/**
 * The signed-in person's device colours. `hex` follows the colour scheme,
 * unless `dark` says what the map is drawn on (a dark map on a light page).
 */
export function useDeviceColors(options: { dark?: boolean } = {}): DeviceColors {
  const { data: devices } = useDevices();
  const prefersDark = usePrefersDark();
  const dark = options.dark ?? prefersDark;
  return useMemo(() => {
    const slots = assignDeviceColors(devices ?? []);
    const palette = dark ? devicePalette.dark : devicePalette.light;
    const slot = (deviceId: string): number => slots.get(deviceId) ?? 0;
    return { slot, hex: (deviceId) => palette[slot(deviceId)] ?? palette[0] };
  }, [devices, dark]);
}
