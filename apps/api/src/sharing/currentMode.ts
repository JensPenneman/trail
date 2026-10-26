import type { DeviceRow } from "../devices/findOwnedDevice";

/**
 * The transport mode Trail inferred for the device's current movement, for
 * `activity.mode`. Location processing provides it; until it does, nothing is
 * known and this stays null, so sharing works with or without it.
 */
export function currentModeOf(_device: DeviceRow): string | null {
  return null;
}
