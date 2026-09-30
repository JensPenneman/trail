import { devicePaletteSize } from "./devicePalette";

/**
 * Palette slot per device, in creation order: the oldest device (usually the
 * owner's main phone) always gets the first colour, and filtering a view never
 * repaints the devices that remain.
 */
export function assignDeviceColors(
  devices: readonly { id: string; createdAt: string }[],
): ReadonlyMap<string, number> {
  const ordered = [...devices].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
  return new Map(ordered.map((device, index) => [device.id, index % devicePaletteSize]));
}
