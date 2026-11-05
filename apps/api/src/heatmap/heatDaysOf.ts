import { addDays } from "../lib/calendarDate";
import { localDate } from "../lib/localDate";

/** Every local day from the one `from` falls in to the one `to` does (a range ending at midnight, the day before). */
export function heatDaysOf(from: Date, to: Date, timezone: string): string[] {
  const first = localDate(from, timezone);
  const last = localDate(new Date(Math.max(from.getTime(), to.getTime() - 1)), timezone);
  const days: string[] = [];
  // A window is a few days at most; a longer span (a deleted range) is bounded by the days with points.
  for (let day = first; day <= last && days.length < 4000; day = addDays(day, 1)) days.push(day);
  return days;
}
