import type { TrackPoint } from "@trail/contracts/track";
import { trackSegments } from "@trail/contracts/trackSegments";
import type { Segment } from "@trail/contracts/transport";
import { metresBetween } from "../../../../map/lineGeometry";
import { addDays } from "../../../../time/addDays";
import { localDateOf } from "../../../../time/localDateOf";
import { startOfLocalDay } from "../../../../time/startOfLocalDay";

/** Playback minutes that pass per second of the clock: the speeds on offer. */
export const playbackRates = [1, 5, 15, 60] as const;
export type PlaybackRate = (typeof playbackRates)[number];

/** `[from, to)` in epoch seconds. */
export interface Interval {
  from: number;
  to: number;
}

/** Slower than this a device is standing still (m/s), as the movement stretches count it. */
const stillSpeed = 0.6;
/** A stretch this long below `stillSpeed` ends a movement. */
const stillAfterS = 3 * 60;
/** A movement is kept when it lasts this long and covers this far. */
const minMoveS = 60;
const minMoveM = 100;
/** A quiet stretch longer than this is what "Skip stops" jumps over. */
export const skippableQuietS = 2 * 60;

/** A local day `[start, end)` in epoch seconds; days are 23 or 25 hours long around DST. */
export function dayBounds(day: string, timeZone: string): { start: number; end: number } {
  return {
    start: startOfLocalDay(day, timeZone) / 1000,
    end: startOfLocalDay(addDays(day, 1), timeZone) / 1000,
  };
}

/** The local day an instant (epoch seconds) falls on. */
export const dayOf = (time: number, timeZone: string): string => localDateOf(time * 1000, timeZone);

/** Sorted, overlapping and touching intervals made one. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last !== undefined && interval.from <= last.to) last.to = Math.max(last.to, interval.to);
    else merged.push({ ...interval });
  }
  return merged;
}

/** The timeline's moves, merged across devices: when something of one's own was travelling. */
export function movesOf(segments: readonly Segment[]): Interval[] {
  return mergeIntervals(
    segments
      .filter((segment) => segment.kind === "move")
      .map((segment) => ({
        from: Date.parse(segment.startedAt) / 1000,
        to: Date.parse(segment.endedAt) / 1000,
      })),
  );
}

/**
 * When a device moved, from its points alone (for someone else, whose
 * timeline Trail does not serve, and for one's own while processing has not
 * caught up): pieces split at recording gaps, cut where it stood below 0.6 m/s
 * for three minutes, kept when they last a minute and cover 100 m.
 */
export function movingStretches(tracks: readonly (readonly TrackPoint[])[]): Interval[] {
  const stretches: Interval[] = [];
  for (const points of tracks) {
    for (const piece of trackSegments(points)) {
      const speeds = piece.map((point, index) => {
        if (point[3] !== null) return point[3];
        const before = piece[index - 1];
        if (before === undefined || point[2] === before[2]) return 0;
        return metresBetween([before[0], before[1]], [point[0], point[1]]) / (point[2] - before[2]);
      });
      // The points that belong to a long enough stand-still.
      const still = new Array<boolean>(piece.length).fill(false);
      let runStart = -1;
      for (let index = 0; index <= piece.length; index += 1) {
        const slow = index < piece.length && (speeds[index] ?? 0) < stillSpeed;
        if (slow && runStart < 0) runStart = index;
        if (!slow && runStart >= 0) {
          const first = piece[runStart];
          const last = piece[index - 1];
          if (first !== undefined && last !== undefined && last[2] - first[2] >= stillAfterS) {
            still.fill(true, runStart, index);
          }
          runStart = -1;
        }
      }
      let from = -1;
      for (let index = 0; index <= piece.length; index += 1) {
        const moving = index < piece.length && !still[index];
        if (moving && from < 0) from = index;
        if (!moving && from >= 0) {
          const run = piece.slice(from, index);
          from = -1;
          const first = run[0];
          const last = run.at(-1);
          if (first === undefined || last === undefined || last[2] - first[2] < minMoveS) continue;
          let metres = 0;
          for (let step = 1; step < run.length; step += 1) {
            const a = run[step - 1];
            const b = run[step];
            if (a !== undefined && b !== undefined) {
              metres += metresBetween([a[0], a[1]], [b[0], b[1]]);
            }
          }
          if (metres >= minMoveM) stretches.push({ from: first[2], to: last[2] });
        }
      }
    }
  }
  return mergeIntervals(stretches);
}

/** What is left of `span` outside the moves: where nothing travels (stops, visits, gaps, nights). */
export function quietIntervals(span: Interval, moves: readonly Interval[]): Interval[] {
  const quiet: Interval[] = [];
  let at = span.from;
  for (const move of mergeIntervals(moves)) {
    if (move.to <= at) continue;
    if (move.from >= span.to) break;
    if (move.from > at) quiet.push({ from: at, to: move.from });
    at = Math.max(at, move.to);
  }
  if (at < span.to) quiet.push({ from: at, to: span.to });
  return quiet;
}

/** The first day after `day` that has data, from days sorted ascending; null when none. */
export function nextDayWithData(days: readonly string[], day: string): string | null {
  return days.find((candidate) => candidate > day) ?? null;
}

/** The last day before `day` that has data; null when none. */
export function previousDayWithData(days: readonly string[], day: string): string | null {
  return [...days].reverse().find((candidate) => candidate < day) ?? null;
}

/**
 * Where playback ends: the last point of the final day once that day's track
 * is in, until then the days endpoint's first guess (its latest `lastAt`).
 * Unknown while the list of days is incomplete: its latest day is then only
 * the window's last, and an end taken from it would stop playback there.
 */
export function endOf(
  guess: number | null,
  finalDayLast: number | null,
  daysComplete: boolean,
): number | null {
  return daysComplete ? (finalDayLast ?? guess) : null;
}

/**
 * The cursor as the map's split is made from it: rounded down to a quarter of
 * the playback minutes that pass in a second, so that the tracks are cut
 * four times a second at most however often the clock moves. Pass this, not
 * the clock, as `until` to `tracksToMap`, `levelTracksToMap` and `useTransportMap`.
 */
export function splitTime(clock: number, rate: PlaybackRate): number {
  const step = (rate * 60) / 4;
  return Math.floor(clock / step) * step;
}

/** "Moving" or "Still", from a speed in m/s (for someone whose timeline Trail does not serve). */
export const movementOf = (speed: number | null): "Moving" | "Still" | null =>
  speed === null ? null : speed >= stillSpeed ? "Moving" : "Still";
