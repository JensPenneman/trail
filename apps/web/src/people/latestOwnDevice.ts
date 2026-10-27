import type { DeviceSummary } from "@trail/contracts/device";

const timeOf = (instant: string | null | undefined): number =>
  instant === null || instant === undefined ? Number.NEGATIVE_INFINITY : Date.parse(instant);

/**
 * The signed-in person's device that reported last — its position says where
 * they are now, and the Me card's quick toggle applies to it — else the one
 * that uploaded last, else the first; null without devices.
 */
export function latestOwnDevice(devices: readonly DeviceSummary[]): DeviceSummary | null {
  let best: DeviceSummary | null = null;
  for (const device of devices) {
    if (best === null) {
      best = device;
      continue;
    }
    const located = timeOf(device.lastLocation?.recordedAt);
    const bestLocated = timeOf(best.lastLocation?.recordedAt);
    if (
      located > bestLocated ||
      (located === bestLocated && timeOf(device.lastSeenAt) > timeOf(best.lastSeenAt))
    ) {
      best = device;
    }
  }
  return best;
}
