import { localDate } from "./localDate";
import { zoneOffsetMs } from "./zonedParts";

const quarterHourMs = 15 * 60_000;

const dateAt = (instant: number, timeZone: string): string =>
  localDate(new Date(instant), timeZone);

/**
 * The instant (epoch ms) a local calendar day `YYYY-MM-DD` begins in
 * `timeZone`. The offset changes around summer time, so the first guess is
 * corrected with the offset at the guess itself; where a zone skips midnight
 * the day starts at the first wall-clock time that exists. Offsets are whole
 * quarter hours, the steps the search takes.
 */
export function startOfLocalDay(date: string, timeZone: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  let candidate = midnightAsUtc - zoneOffsetMs(midnightAsUtc, timeZone);
  candidate = midnightAsUtc - zoneOffsetMs(candidate, timeZone);
  // A skipped midnight: on to the first quarter hour that falls on the date.
  for (let step = 0; step < 16 && dateAt(candidate, timeZone) !== date; step += 1) {
    candidate += dateAt(candidate, timeZone) < date ? quarterHourMs : -quarterHourMs;
  }
  // The earliest instant of the date.
  while (dateAt(candidate - quarterHourMs, timeZone) === date) candidate -= quarterHourMs;
  return candidate;
}
