import type { DeviceSummary } from "@trail/contracts/device";
import type { ReactNode } from "react";
import { devicePath } from "../../devices/devicePaths";
import { SettingsPage } from "../../settings/SettingsPage";
import { type SettingsPartId, settingsPart } from "../../settings/settingsTree";
import { DeviceUnavailable } from "./DeviceUnavailable";
import { useRoutedDevice } from "./useRoutedDevice";

interface DevicePartPageProps {
  part: SettingsPartId;
  /** The line under the title, when it says more than the tree's. */
  description?: (device: DeviceSummary) => ReactNode;
  children: (device: DeviceSummary) => ReactNode;
}

/**
 * The page of a part of a device, a level below the device's own (Settings ›
 * Devices › iPhone 16 › Uploads): its title from the tree, the way back to
 * the device's page by the device's name, and the part once the device is
 * there.
 */
export function DevicePartPage({ part, description, children }: DevicePartPageProps) {
  const { deviceId, device } = useRoutedDevice();
  if (device.data === undefined) {
    return <DeviceUnavailable deviceId={deviceId} device={device} part={part} />;
  }
  const current = device.data;
  const node = settingsPart(part);
  return (
    <SettingsPage
      parent="devices"
      item={{ path: devicePath(current.id), label: current.name }}
      title={node.label}
      description={description === undefined ? node.description : description(current)}
    >
      {children(current)}
    </SettingsPage>
  );
}
