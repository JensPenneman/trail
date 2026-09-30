import { localDayRange } from "./localDayRange";

const maxSpanMs = 93 * 86_400_000;

/**
 * `[from, to)` for local dates `first..last`, never longer than the API's
 * 93-day limit: 93 local days are an hour longer when they include the end of
 * summer time, so that last hour is cut off rather than the request failing.
 */
export function boundedRange(
  first: string,
  last: string,
  timeZone: string,
): { from: string; to: string } {
  const range = localDayRange(first, last, timeZone);
  const end = Math.min(Date.parse(range.to), Date.parse(range.from) + maxSpanMs);
  return { from: range.from, to: new Date(end).toISOString() };
}
