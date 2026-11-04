import type { ProcessingLevel } from "@trail/contracts/transport";
import { useMemo } from "react";
import { useLevelTracks } from "../../../../queries/useLevelTracks";
import type { PersonTrackRequest } from "../../../../queries/usePersonTracks";
import { usePersonTracks } from "../../../../queries/usePersonTracks";
import { useTimeline } from "../../../../queries/useTimeline";
import { useTracks } from "../../../../queries/useTracks";
import { useVisits } from "../../../../queries/useVisits";
import { localDayRange } from "../../../../time/localDayRange";
import { dayBounds, type Interval, nextDayWithData } from "./playbackModel";

/** The share of a day after which the next one is loaded. */
const prefetchAt = 0.9;

/**
 * Loads the next day with data while the current one plays, from 90 % of the
 * way through it (21:36), so that midnight finds it in — or, with Skip stops
 * on, once no move is left in the day: the night after the last one is jumped
 * over in half a second, long before 21:36. Queries must stay
 * mounted to keep their data — a sharer's tracks are not cached once off
 * screen — so this hook mounts them, rather than prefetching: the day's
 * tracks and, at a level other than raw, its level tracks, with its
 * timeline and visits for one's own; for someone else their track request
 * for that day, built by `personRequest`. Returns the day being loaded.
 */
export function usePlaybackPrefetch({
  active,
  day,
  clock,
  days,
  timeZone,
  level,
  moves,
  skipStops,
  me,
  personRequest,
}: {
  active: boolean;
  day: string;
  /** Epoch seconds. */
  clock: number;
  days: readonly string[];
  timeZone: string;
  level: ProcessingLevel;
  /** The moves of the day (empty until they are known). */
  moves: readonly Interval[];
  skipStops: boolean;
  /** One's own devices (null for all) when the person played is oneself; null for someone else. */
  me: { deviceIds: readonly string[] | null } | null;
  /** Someone else's track request for a day's `[from, to)`; null for oneself or no request. */
  personRequest: ((range: { from: string; to: string }) => PersonTrackRequest | null) | null;
}): { nextDay: string | null } {
  const { start, end } = dayBounds(day, timeZone);
  const lateInDay = clock >= start + (end - start) * prefetchAt;
  // A day without moves (a day at home) is jumped whole: nothing is left to see in it either.
  const nothingLeftToSee = skipStops && moves.every((move) => move.to <= clock);
  const next = active && (lateInDay || nothingLeftToSee) ? nextDayWithData(days, day) : null;
  const range = useMemo(
    () => (next === null ? null : localDayRange(next, next, timeZone)),
    [next, timeZone],
  );
  const own = me !== null && range !== null ? { ...range, deviceIds: me.deviceIds } : null;
  useTracks(own);
  useLevelTracks(own === null || level === "raw" ? null : { ...own, level });
  useTimeline(own);
  useVisits(own);
  const requests = useMemo(() => {
    const request = range === null || personRequest === null ? null : personRequest(range);
    return request === null ? [] : [request];
  }, [range, personRequest]);
  usePersonTracks(requests);
  return { nextDay: next };
}
