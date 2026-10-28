import { DevicePartPage } from "./DevicePartPage";
import { RawPointsSection } from "./RawPointsSection";

/** Settings › Devices › a device › Raw points: every point it stored, a page at a time. */
export function DevicePointsPage() {
  return (
    <DevicePartPage part="points">
      {(device) => <RawPointsSection deviceId={device.id} lastSeenAt={device.lastSeenAt} />}
    </DevicePartPage>
  );
}
