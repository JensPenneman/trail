import type { DeviceSummary } from "@trail/contracts/device";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { QuickModeChips, toggleMinutes } from "../../transport/QuickModeChips";

/**
 * The quick toggle for this device: the Me card's applies to the device that
 * reported last, so a second phone (a tracker in the car, an old iPhone) gets
 * its mode set here.
 */
export function TravelModeSection({ device }: { device: DeviceSummary }) {
  return (
    <SettingsGroup
      title="Travelling now"
      variant="card"
      footer={`How this device travels from now until it stops for ${toggleMinutes} minutes or more or travels another way; Auto leaves it to Trail.`}
    >
      <QuickModeChips deviceId={device.id} deviceName={device.name} />
    </SettingsGroup>
  );
}
