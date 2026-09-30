import { parseLocalDate } from "./parseLocalDate";

/** Calendar arithmetic on `YYYY-MM-DD` (no time zone involved: a day is a day). */
export function addDays(date: string, days: number): string {
  const parsed = parseLocalDate(date);
  if (parsed === null) throw new RangeError(`Not a calendar date: ${date}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days))
    .toISOString()
    .slice(0, 10);
}
