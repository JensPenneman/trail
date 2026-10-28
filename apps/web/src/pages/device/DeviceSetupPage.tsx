import { deviceAppInfo, platformsLabel } from "@trail/contracts/deviceApp";
import { DevicePartPage } from "./DevicePartPage";
import { DeviceSetupSection } from "./DeviceSetupSection";

/**
 * Settings › Devices › a device › Setup: the app it records with, how that
 * app is connected (without the token) and the settings Trail recommends.
 */
export function DeviceSetupPage() {
  return (
    <DevicePartPage
      part="setup"
      description={(device) => {
        const app = deviceAppInfo[device.source];
        return `${app.name} (${platformsLabel(app.platforms)}). To set the phone up again, or with another app, issue a new token on the device’s page: Trail shows the token only when it issues one.`;
      }}
    >
      {(device) => <DeviceSetupSection device={device} />}
    </DevicePartPage>
  );
}
