import {
  type SettingsPartId,
  settingsItemPath,
  settingsPage,
  settingsPart,
} from "../settings/settingsTree";

/*
 * Where the devices live: Settings › Devices, a page per device and a page
 * per part of one (docs/architecture.md §14). Every link to them is made
 * here, from the Settings tree.
 */

/** Settings › Devices: the list, the uploads of every device, adding one. */
export const devicesPath = settingsPage("devices").path;

/** Settings › Devices with the Add device dialog open. */
export const addDevicePath = `${devicesPath}?add=1`;

const deviceDetail = settingsPage("devices").details?.find((detail) => detail.id === "device");
if (deviceDetail === undefined) throw new Error("No page per device in the Settings tree");
const devicePattern = deviceDetail.path;

/** A device's page, or the page of a part of it (`uploads`, `points`, `tracking`, `setup`). */
export function devicePath(deviceId: string, part?: SettingsPartId): string {
  return settingsItemPath(part === undefined ? devicePattern : settingsPart(part).path, deviceId);
}
