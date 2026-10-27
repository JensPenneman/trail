/*
 * Calendar arithmetic on local dates `YYYY-MM-DD` (validated by the caller):
 * no time zone involved, a day is a day.
 */

const dayMs = 86_400_000;

/** The date as a UTC midnight, for arithmetic only. */
function utcOf(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

const dateOf = (utc: number): string => new Date(utc).toISOString().slice(0, 10);

/** The date `days` later (earlier when negative). */
export function addDays(date: string, days: number): string {
  return dateOf(utcOf(date) + days * dayMs);
}

/** Whole days from `from` to `to`: 0 for the same date, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / dayMs);
}

/** The ISO day of the week: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  return new Date(utcOf(date)).getUTCDay() || 7;
}
