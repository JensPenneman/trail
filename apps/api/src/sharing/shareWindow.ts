const dayMs = 86_400_000;

/**
 * How old the newest position of a live-only share may be: the server's
 * silence threshold (`STALE_AFTER_HOURS`). Overland pauses while a phone
 * stands still, so a person at home keeps their place this long; a phone that
 * went quiet longer ago is no longer where its owner is.
 */
export const liveWindowMs = (config: { staleAfterHours: number }): number =>
  config.staleAfterHours * 3_600_000;

/**
 * The earliest instant a share or link shows positions from: `historyDays`
 * back, or the live window for live-only grants (docs/architecture.md §8.4).
 */
export function windowStart(historyDays: number | null, now: Date, liveMs: number): Date {
  return new Date(now.getTime() - (historyDays === null ? liveMs : historyDays * dayMs));
}

/** Whether a grant names the device: null means every device of its owner. */
export const coversDevice = (deviceIds: readonly string[] | null, deviceId: string): boolean =>
  deviceIds === null || deviceIds.includes(deviceId);
