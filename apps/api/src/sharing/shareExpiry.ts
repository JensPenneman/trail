import type { ShareDuration } from "@trail/contracts/share";
import { localDate } from "../lib/localDate";

const hourMs = 3_600_000;
/** A local day is at most 25 hours long (a little more with historical offsets): this is safely beyond. */
const searchSpanS = 27 * 3600;

/**
 * The first instant after `now` that falls on a later local date in
 * `timeZone`: "the end of my day". Found by bisection on the local date, so
 * days of 23 or 25 hours and zones that skip midnight (the day then starts at
 * 01:00) need no special cases. Zone offsets are whole minutes, so the
 * boundary is a whole second.
 */
export function endOfLocalDay(now: Date, timeZone: string): Date {
  const today = localDate(now, timeZone);
  let stillToday = Math.floor(now.getTime() / 1000);
  let laterDay = stillToday + searchSpanS;
  while (laterDay - stillToday > 1) {
    const middle = stillToday + Math.floor((laterDay - stillToday) / 2);
    if (localDate(new Date(middle * 1000), timeZone) === today) stillToday = middle;
    else laterDay = middle;
  }
  return new Date(laterDay * 1000);
}

/** When a share of `duration`, started (or changed) at `now`, ends; null when it runs until stopped. */
export function shareExpiresAt(duration: ShareDuration, now: Date, timeZone: string): Date | null {
  switch (duration) {
    case "hour":
      return new Date(now.getTime() + hourMs);
    case "endOfDay":
      return endOfLocalDay(now, timeZone);
    case "week":
      return new Date(now.getTime() + 7 * 24 * hourMs);
    case "indefinitely":
      return null;
  }
}
