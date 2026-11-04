import { useMemo, useState } from "react";
import { useDays } from "../../../../queries/useDays";
import { addDays } from "../../../../time/addDays";

/** The stats API allows 400 days a request. */
const windowDays = 400;
/** Within this many days of a window's end the next window starts. */
const windowMargin = 14;

/** Days with data, and the time of the last point of each (epoch seconds). */
export interface PlaybackDays {
  /** Local dates with data, ascending. */
  days: readonly string[];
  /** When the last point of each of those days was recorded, epoch seconds. */
  lastAt: ReadonlyMap<string, number>;
  /** The list reaches today: no later day can still turn up. */
  complete: boolean;
}

/**
 * What someone else's days endpoint gives (`GET /api/v1/people/{id}/days`,
 * which arrives with the playback wiring): the caller asks, this hook only
 * reads. Days without points are not in it.
 */
export interface PersonDays {
  days: readonly { date: string; lastAt: string }[];
  /** The answer reaches today. */
  complete: boolean;
}

export type PlaybackDaysSource =
  | { kind: "me"; deviceIds: readonly string[] | null }
  | { kind: "person"; days: PersonDays | undefined };

const none: PlaybackDays = { days: [], lastAt: new Map(), complete: false };

/**
 * The days playback can visit, from the day it starts on: one's own through
 * `/api/stats/days` in windows of at most 400 days (the next window opens
 * when the clock gets within two weeks of the one in hand); someone else's
 * from the answer the caller hands in. Asks for nothing while `active` is false.
 */
export function usePlaybackDays({
  active,
  startDay,
  playingDay,
  today,
  source,
}: {
  active: boolean;
  startDay: string;
  /** The day the clock is in, to move the window along. */
  playingDay: string;
  today: string;
  source: PlaybackDaysSource;
}): PlaybackDays {
  // The window starts where playback did and moves on to the day being played when that is near
  // the window's end, so a long stretch of days is covered by a few requests.
  const [anchor, setAnchor] = useState({ startDay, from: startDay });
  const from = anchor.startDay === startDay ? anchor.from : startDay;
  const windowEnd = addDays(from, windowDays - 1);
  if (anchor.startDay !== startDay) setAnchor({ startDay, from: startDay });
  else if (
    active &&
    windowEnd < today &&
    playingDay > addDays(windowEnd, -windowMargin) &&
    playingDay > from
  ) {
    setAnchor({ startDay, from: playingDay });
  }
  const to = windowEnd < today ? windowEnd : today;
  const mine = source.kind === "me";
  const query = useDays(
    active && mine ? { from, to, deviceIds: source.kind === "me" ? source.deviceIds : null } : null,
  );
  const sharer = source.kind === "person" ? source.days : undefined;

  return useMemo<PlaybackDays>(() => {
    if (!active) return none;
    if (source.kind === "person") {
      if (sharer === undefined) return none;
      const days = [...new Set(sharer.days.map((day) => day.date))].sort();
      return {
        days,
        lastAt: new Map(sharer.days.map((day) => [day.date, Date.parse(day.lastAt) / 1000])),
        complete: sharer.complete,
      };
    }
    const lastAt = new Map<string, number>();
    for (const day of query.data?.days ?? []) {
      if (day.points === 0) continue;
      const at = Date.parse(day.lastAt) / 1000;
      lastAt.set(day.date, Math.max(lastAt.get(day.date) ?? 0, at));
    }
    return {
      days: [...lastAt.keys()].sort(),
      lastAt,
      complete: query.data !== undefined && !query.isPlaceholderData && to === today,
    };
  }, [active, source.kind, sharer, query.data, query.isPlaceholderData, to, today]);
}
