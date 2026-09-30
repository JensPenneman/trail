import { localDateOf } from "./localDateOf";
import { parseLocalDate } from "./parseLocalDate";
import { timeZoneOffsetMs } from "./timeZoneOffsetMs";

/**
 * The instant a local calendar day begins in `timeZone` (epoch ms). Offsets
 * change around DST, so the guess is corrected once with the offset at the
 * candidate itself; where a zone skips midnight the day starts at the first
 * wall-clock time that exists.
 */
export function startOfLocalDay(date: string, timeZone: string): number {
  const parsed = parseLocalDate(date);
  if (parsed === null) throw new RangeError(`Not a calendar date: ${date}`);
  const midnightAsUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  let candidate = midnightAsUtc - timeZoneOffsetMs(midnightAsUtc, timeZone);
  const corrected = midnightAsUtc - timeZoneOffsetMs(candidate, timeZone);
  if (corrected !== candidate) candidate = corrected;
  // Skipped midnight: step forward in quarter hours until the date matches.
  for (let step = 0; step < 16 && localDateOf(candidate, timeZone) !== date; step += 1) {
    candidate += localDateOf(candidate, timeZone) < date ? 15 * 60_000 : -15 * 60_000;
  }
  // The earliest instant of the date: walk back while the previous quarter hour is still that date.
  while (localDateOf(candidate - 15 * 60_000, timeZone) === date) candidate -= 15 * 60_000;
  return candidate;
}
