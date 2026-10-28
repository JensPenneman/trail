import type { CacheStamp, DayStamp } from "@trail/contracts/cacheStamp";

/** A digest row's place: one device's local day. */
export const stampPlace = (deviceId: string, date: string): string => `${deviceId}|${date}`;

/**
 * Whether an answer's stamps are the digest's (`/api/stats/days`) for the same
 * device-days, both ways: every stamp has its row with the same value, and
 * the digest has no row the answer has no stamp for (a device that recorded
 * the day since). `raw` compares the recorded data — tracks, visits, trips,
 * raw level tracks — and `both` its processing too, where a day without
 * stops and moves yet (a null `processed`) never matches. A row without a
 * stamp (an older server) never matches either.
 */
export function stampsMatch(
  stamps: readonly DayStamp[],
  rows: ReadonlyMap<string, CacheStamp | undefined>,
  compare: "raw" | "both",
): boolean {
  if (stamps.length === 0 || stamps.length !== rows.size) return false;
  for (const stamp of stamps) {
    const row = rows.get(stampPlace(stamp.deviceId, stamp.date));
    if (row === undefined || row.raw !== stamp.raw) return false;
    if (compare === "both" && (stamp.processed === null || row.processed !== stamp.processed)) {
      return false;
    }
  }
  return true;
}
