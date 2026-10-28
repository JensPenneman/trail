import { addDays, daysBetween } from "./calendarDate";
import { localDate } from "./localDate";

/** The days between two ends are listed only this far apart; past it the two ends stand for the span. */
const listedDays = 31;

/**
 * The local days from `from` to `to`, both included — the two ends only when
 * they lie more than a month apart, and `from`'s alone when `to` comes
 * first. What tells open pages which days changed (the `days` event): a
 * record can claim decades, and the stamps, read from the tables, are right
 * whatever is named here.
 */
export function spannedLocalDays(from: Date, to: Date, timezone: string): string[] {
  const first = localDate(from, timezone);
  const last = localDate(to, timezone);
  if (last < first) return [first];
  if (daysBetween(first, last) > listedDays) return [first, last];
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}
