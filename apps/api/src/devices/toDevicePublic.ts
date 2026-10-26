import type { DeviceSummary } from "@trail/contracts/device";
import type { DevicePublic } from "@trail/contracts/devicePublic";
import { hasScope, type RequestAuth } from "../auth/requestAuth";

/**
 * A dashboard summary as the public API shows it: picked field by field, so
 * nothing else leaks. Where a device is belongs to `locations:read`: without
 * that scope the position is left out (a session holds every scope).
 */
export function toDevicePublic(summary: DeviceSummary, auth: RequestAuth): DevicePublic {
  return {
    id: summary.id,
    name: summary.name,
    source: summary.source,
    createdAt: summary.createdAt,
    lastSeenAt: summary.lastSeenAt,
    ...(hasScope(auth, "locations:read") ? { lastLocation: summary.lastLocation } : {}),
    battery: summary.battery,
    liveTrip: summary.liveTrip,
    counts: summary.counts,
  };
}
