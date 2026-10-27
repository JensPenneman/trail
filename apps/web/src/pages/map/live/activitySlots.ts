import type { ActivityBucket } from "@trail/contracts/stats";

export interface ActivitySlot {
  /** Start of the UTC hour, epoch ms. */
  start: number;
  recorded: number;
  uploads: number;
}

const hourMs = 3_600_000;

/**
 * One slot per hour for `hours` hours ending with the hour containing `to`,
 * zero-filled: the API only returns hours in which something happened.
 */
export function activitySlots(
  buckets: readonly ActivityBucket[],
  deviceId: string,
  to: string,
  hours: number,
): ActivitySlot[] {
  const lastStart = Math.floor(Date.parse(to) / hourMs) * hourMs;
  const firstStart = lastStart - (hours - 1) * hourMs;
  const slots: ActivitySlot[] = Array.from({ length: hours }, (_, index) => ({
    start: firstStart + index * hourMs,
    recorded: 0,
    uploads: 0,
  }));
  for (const bucket of buckets) {
    if (bucket.deviceId !== deviceId) continue;
    const index = Math.round((Date.parse(bucket.start) - firstStart) / hourMs);
    const slot = slots[index];
    if (slot === undefined) continue;
    slot.recorded += bucket.recorded;
    slot.uploads += bucket.uploads;
  }
  return slots;
}
