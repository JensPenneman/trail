import type { LocalHour } from "./localHours";

/** What is prorated: a move's time span (epoch ms) and its distance. */
export interface TimedDistance {
  startMs: number;
  endMs: number;
  distanceM: number;
}

export interface HourPart {
  hour: LocalHour;
  /** Time inside the hour. */
  seconds: number;
  /** The move's distance in proportion to that time. */
  distanceM: number;
}

/** The first hour that ends after `instant` (hours are in order and without gaps). */
function firstEndingAfter(hours: readonly LocalHour[], instant: number): number {
  let low = 0;
  let high = hours.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((hours[middle]?.end ?? 0) <= instant) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * A move's parts in the local hours it overlaps (docs/architecture.md §8.7):
 * the time inside each hour, and the distance in proportion to that time, as
 * `GET /api/v1/stats/modes` prorates by day. Only `hours` count — the period's
 * — so a move across the period's edge counts with the part inside it. A move
 * without duration counts whole in the hour it happened in.
 */
export function hourParts(move: TimedDistance, hours: readonly LocalHour[]): HourPart[] {
  const duration = move.endMs - move.startMs;
  const first = firstEndingAfter(hours, move.startMs);
  if (duration <= 0) {
    const hour = hours[first];
    return hour !== undefined && hour.start <= move.startMs
      ? [{ hour, seconds: 0, distanceM: move.distanceM }]
      : [];
  }
  const parts: HourPart[] = [];
  for (let index = first; index < hours.length; index += 1) {
    const hour = hours[index];
    if (hour === undefined || hour.start >= move.endMs) break;
    const overlap = Math.min(hour.end, move.endMs) - Math.max(hour.start, move.startMs);
    if (overlap > 0) {
      parts.push({
        hour,
        seconds: overlap / 1000,
        distanceM: (move.distanceM * overlap) / duration,
      });
    }
  }
  return parts;
}
