import { addDays, isoWeekday } from "../lib/calendarDate";
import { startOfLocalDay } from "../lib/startOfLocalDay";
import { zonedParts } from "../lib/zonedParts";

const hourMs = 3_600_000;

/** One hour of the local clock: `[start, end)` in epoch ms, with its date, hour and weekday. */
export interface LocalHour {
  start: number;
  end: number;
  /** The local date, `YYYY-MM-DD`. */
  date: string;
  /** 0–23, as the clock shows it. */
  hour: number;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
}

/**
 * The hours of the local days `from..to` (both included) in `timeZone`, in
 * order and without gaps, as the clock shows them: the day summer time starts
 * has 23 (its 02:00 does not exist), the day it ends 25 (02:00 comes twice),
 * and where a zone skips midnight the day starts at the first time that
 * exists. Days of 24 hours number theirs from 0 without asking the zone.
 */
export function localHours(from: string, to: string, timeZone: string): LocalHour[] {
  const hours: LocalHour[] = [];
  let start = startOfLocalDay(from, timeZone);
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const next = startOfLocalDay(addDays(date, 1), timeZone);
    const weekday = isoWeekday(date);
    const regular = next - start === 24 * hourMs;
    for (let at = start, index = 0; at < next; at += hourMs, index += 1) {
      hours.push({
        start: at,
        end: Math.min(at + hourMs, next),
        date,
        hour: regular ? index : zonedParts(at, timeZone).hour,
        weekday,
      });
    }
    start = next;
  }
  return hours;
}
