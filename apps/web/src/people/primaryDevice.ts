import type { SharedDevice } from "@trail/contracts/person";

/** The device that reported last — the one that says where the person is now — else the first. */
export function primaryDevice(devices: readonly SharedDevice[]): SharedDevice | null {
  let best: SharedDevice | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const device of devices) {
    if (device.location === null) continue;
    const time = Date.parse(device.location.recordedAt);
    if (time > bestTime) {
      best = device;
      bestTime = time;
    }
  }
  return best ?? devices[0] ?? null;
}
