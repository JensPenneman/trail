import { localDate } from "../lib/localDate";
import { startOfLocalDay } from "../lib/startOfLocalDay";
import { liveWindowMs, windowStart } from "./shareWindow";

/**
 * The local days a share's history covers, in the owner's time zone: from the
 * day the history window begins in to today. Days belong to the person whose
 * data they are — their daily statistics are cut at their midnights — so
 * every viewer sees the same days. When the window begins in the middle of a
 * day, `partialFrom` is where: that first day is counted from there on, so
 * nothing older than the shared history is revealed by a day's totals.
 */
export function personDaysWindow(
  historyDays: number,
  now: Date,
  timeZone: string,
  config: { staleAfterHours: number },
): { from: string; to: string; partialFrom: Date | null } {
  const start = windowStart(historyDays, now, liveWindowMs(config));
  const from = localDate(start, timeZone);
  const midnight = startOfLocalDay(from, timeZone);
  return {
    from,
    to: localDate(now, timeZone),
    partialFrom: start.getTime() > midnight ? start : null,
  };
}
