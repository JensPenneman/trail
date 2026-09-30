import { zonedParts } from "./zonedParts";

/** How far the zone's wall clock is ahead of UTC at `instant` (e.g. +2 h for Brussels in summer). */
export function timeZoneOffsetMs(instant: number, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Sub-second precision is not part of the wall clock fields.
  return wallClockAsUtc - (instant - (((instant % 1000) + 1000) % 1000));
}
