import { DevicePartPage } from "./DevicePartPage";
import { IngestLogSection } from "./IngestLogSection";

/** Settings › Devices › a device › Uploads: every request its phone made, newest first. */
export function DeviceUploadsPage() {
  return (
    <DevicePartPage part="uploads">
      {(device) => <IngestLogSection deviceId={device.id} app={device.source} />}
    </DevicePartPage>
  );
}
