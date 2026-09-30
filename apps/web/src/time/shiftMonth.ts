import { parseLocalDate } from "./parseLocalDate";

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Moves a local date by whole months, keeping the day of the month where it
 * exists (31 January + 1 month → 28/29 February).
 */
export function shiftMonth(date: string, months: number): string {
  const parsed = parseLocalDate(date);
  if (parsed === null) throw new RangeError(`Not a calendar date: ${date}`);
  const target = new Date(Date.UTC(parsed.year, parsed.month - 1 + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(parsed.day, lastDay))}`;
}
