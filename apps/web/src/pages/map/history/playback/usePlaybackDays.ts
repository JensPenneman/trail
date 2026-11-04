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
 * `/api/stats/days` in windows of at most 400 days; someone else's from the
 * answer the caller hands in. The next window opens when the clock gets within
 * two weeks of the one in hand, or as soon as no later day with data is left in
 * it (a gap at its end), and the days of the windows before it are kept, so
 * that stepping back finds them. Asks for nothing while `active` is false.
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
  // The window starts where playback did and moves on to the day being played; what earlier
  // windows found is carried along.
  const [anchor, setAnchor] = useState<{
    startDay: string;
    from: string;
    carried: ReadonlyMap<string, number>;
  }>({ startDay, from: startDay, carried: new Map() });
  const fresh = anchor.startDay === startDay;
  const from = fresh ? anchor.from : startDay;
  const carried = fresh ? anchor.carried : none.lastAt;
  const windowEnd = addDays(from, windowDays - 1);
  const to = windowEnd < today ? windowEnd : today;
  const query = useDays(
    active && source.kind === "me" ? { from, to, deviceIds: source.deviceIds } : null,
  );
  // Placeholder data belongs to another window or another set of devices: not days of this one.
  const answered = query.data !== undefined && !query.isPlaceholderData;

  const mine = useMemo(() => {
    const lastAt = new Map(carried);
    if (answered) {
      for (const day of query.data?.days ?? []) {
        if (day.points === 0) continue;
        const at = Date.parse(day.lastAt) / 1000;
        lastAt.set(day.date, Math.max(lastAt.get(day.date) ?? 0, at));
      }
    }
    return lastAt;
  }, [carried, answered, query.data]);

  if (!fresh) setAnchor({ startDay, from: startDay, carried: new Map() });
  else if (active && source.kind === "me" && windowEnd < today && answered && playingDay > from) {
    const lastDay = [...mine.keys()].sort().at(-1) ?? "";
    if (playingDay > addDays(windowEnd, -windowMargin) || lastDay <= playingDay) {
      setAnchor({ startDay, from: playingDay, carried: mine });
    }
  }
  const sharer = source.kind === "person" ? source.days : undefined;

  return useMemo<PlaybackDays>(() => {
    if (!active) return none;
    if (source.kind === "person") {
      if (sharer === undefined) return none;
      const lastAt = new Map<string, number>();
      for (const day of sharer.days) {
        // One row per device and day: the latest of them is the day's last point.
        lastAt.set(day.date, Math.max(lastAt.get(day.date) ?? 0, Date.parse(day.lastAt) / 1000));
      }
      return { days: [...lastAt.keys()].sort(), lastAt, complete: sharer.complete };
    }
    return {
      days: [...mine.keys()].sort(),
      lastAt: mine,
      complete: answered && to === today,
    };
  }, [active, source.kind, sharer, mine, answered, to, today]);
}
