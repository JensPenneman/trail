import type { ShareDuration, SharePrecision } from "@trail/contracts/share";
import type { Formatter } from "../format/createFormatter";
import { localDateOf } from "../time/localDateOf";

/** What each precision shows, in plain words (the dialogs and the cards use the same). */
export const precisionInfo: Readonly<
  Record<
    SharePrecision,
    {
      label: string;
      short: string;
      /** How far off a position may be, for a card's line; null when it is not cut. */
      within: string | null;
      description: string;
    }
  >
> = {
  precise: {
    label: "Precise",
    short: "Precise location",
    within: null,
    description: "Where you are, as your phone records it.",
  },
  approximate: {
    label: "Approximate",
    short: "Approximate location, within about 500 m",
    within: "Within about 500 m",
    description:
      "Within about 500 m: the neighbourhood, not the street. The same spot is shown every time, so looking often reveals nothing more.",
  },
  area: {
    label: "Area",
    short: "Area only, within about 5 km",
    within: "Within about 5 km",
    description:
      "Within about 5 km: the town or the part of the city, without your speed. The same area every time.",
  },
};

export const durationLabels: Readonly<Record<ShareDuration, string>> = {
  hour: "For one hour",
  endOfDay: "Until the end of the day",
  week: "For a week",
  indefinitely: "Until I stop it",
};

/** "Until 23:00", "Until Tue 3 Nov, 14:05", "Until stopped". */
export function expiryText(expiresAt: string | null, format: Formatter, now: number): string {
  if (expiresAt === null) return "Until stopped";
  const end = Date.parse(expiresAt);
  if (end <= now) return "Ended";
  const sameDay = localDateOf(end, format.timeZone) === localDateOf(now, format.timeZone);
  return `Until ${sameDay ? format.time(end) : format.dayTime(end)}`;
}

/** "Live only", "Last 24 hours", "Last 7 days". */
export function historyText(historyDays: number | null): string {
  if (historyDays === null) return "Live only";
  return historyDays === 1 ? "Last 24 hours" : `Last ${historyDays} days`;
}

/** "All devices", "No devices", or the names the share lists (unknown ones were deleted). */
export function devicesText(
  deviceIds: readonly string[] | null,
  devices: readonly { id: string; name: string }[],
  format: Formatter,
): string {
  if (deviceIds === null) return "All devices";
  const names = devices.filter((device) => deviceIds.includes(device.id)).map((d) => d.name);
  return names.length === 0 ? "No devices" : format.list(names);
}
