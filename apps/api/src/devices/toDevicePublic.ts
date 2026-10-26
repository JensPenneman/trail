import type { DeviceSummary } from "@trail/contracts/device";
import type { DevicePublic } from "@trail/contracts/devicePublic";

/** A dashboard summary as the public API shows it: picked field by field, so nothing else leaks. */
export function toDevicePublic(summary: DeviceSummary): DevicePublic {
  return {
    id: summary.id,
    name: summary.name,
    source: summary.source,
    createdAt: summary.createdAt,
    lastSeenAt: summary.lastSeenAt,
    lastLocation: summary.lastLocation,
    battery: summary.battery,
    liveTrip: summary.liveTrip,
    counts: summary.counts,
  };
}
