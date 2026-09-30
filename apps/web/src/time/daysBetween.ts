import { parseLocalDate } from "./parseLocalDate";

/** Whole days from `from` to `to` (0 for the same date, negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  if (a === null || b === null) throw new RangeError(`Not a calendar date: ${from} / ${to}`);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}
