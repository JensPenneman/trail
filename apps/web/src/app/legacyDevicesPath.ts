import { devicesPath } from "../devices/devicePaths";

/**
 * Where an address of the Devices page of old leads now that the devices
 * live in Settings (`/devices?add=1` → `/settings/devices?add=1`,
 * `/devices/<id>` → `/settings/devices/<id>`): the device, the query and the
 * anchor as they were, so links and bookmarks keep working.
 */
export function legacyDevicesPath(
  location: Readonly<{ pathname: string; search: string; hash: string }>,
): string {
  const rest = location.pathname.replace(/^\/devices/, "").replace(/\/$/, "");
  return `${devicesPath}${rest}${location.search}${location.hash}`;
}
