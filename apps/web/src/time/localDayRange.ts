import { addDays } from "./addDays";
import { startOfLocalDay } from "./startOfLocalDay";

/** `[from, to)` instants covering local dates `first..last` inclusive, as ISO strings for the API. */
export function localDayRange(
  first: string,
  last: string,
  timeZone: string,
): { from: string; to: string } {
  return {
    from: new Date(startOfLocalDay(first, timeZone)).toISOString(),
    to: new Date(startOfLocalDay(addDays(last, 1), timeZone)).toISOString(),
  };
}
