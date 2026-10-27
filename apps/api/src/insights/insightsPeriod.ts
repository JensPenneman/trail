import {
  type InsightsBucket,
  type InsightsPeriod,
  insightsMaxYears,
  lastInsightsDay,
} from "@trail/contracts/insights";
import { HttpError } from "../http/httpError";
import { addDays, daysBetween, isoWeekday } from "../lib/calendarDate";

/** The earliest first day of a period that ends on `to`: the inverse of `lastInsightsDay`. */
export function firstInsightsDay(to: string): string {
  const [year = 0] = to.split("-").map(Number);
  // Two days before the same date three years earlier, then forward to the first that reaches `to`.
  let from = addDays(`${String(year - insightsMaxYears).padStart(4, "0")}${to.slice(4)}`, -2);
  while (lastInsightsDay(from) < to) from = addDays(from, 1);
  return from;
}

const invalidPeriod = (message: string): HttpError =>
  new HttpError(400, "validation_failed", `Invalid request — to: ${message}`, { to: [message] });

/**
 * The local days a request covers (docs/architecture.md §8.7): `to` is today
 * when left out, `from` the first day with data (`firstDay`, or `to` when
 * there is none) but no more than three years before `to`. The query schema
 * checks the order and span of two given dates; a left-out one is checked here.
 */
export function resolvePeriod(
  query: { from?: string | undefined; to?: string | undefined },
  today: string,
  firstDay: string | null,
): InsightsPeriod {
  const to = query.to ?? today;
  const earliest = firstInsightsDay(to);
  let from = query.from;
  if (from === undefined) {
    // The first day with data, but never after `to` nor more than three years before it.
    if (firstDay === null || firstDay > to) from = to;
    else if (firstDay < earliest) from = earliest;
    else from = firstDay;
  }
  if (to < from) throw invalidPeriod("`to` must not be before `from`");
  if (from < earliest) {
    throw invalidPeriod(`The period can span at most ${insightsMaxYears} years`);
  }
  return { from, to, days: daysBetween(from, to) + 1 };
}

/** The period of as many days just before: what the deltas compare with. */
export function previousPeriod(period: InsightsPeriod): InsightsPeriod {
  return {
    from: addDays(period.from, -period.days),
    to: addDays(period.from, -1),
    days: period.days,
  };
}

/** The steps of a series by the period's length: ≤ 31 days by day, ≤ 26 weeks by week, else by month. */
export function bucketFor(days: number): InsightsBucket {
  if (days <= 31) return "day";
  if (days <= 26 * 7) return "week";
  return "month";
}

/** The first day of the step a date falls in: itself, its week's Monday, its month's 1st. */
export function bucketOf(date: string, bucket: InsightsBucket): string {
  switch (bucket) {
    case "day":
      return date;
    case "week":
      return addDays(date, 1 - isoWeekday(date));
    case "month":
      return `${date.slice(0, 7)}-01`;
  }
}

/** Every step of the period, by its first day, in order. */
export function bucketsOf(period: InsightsPeriod, bucket: InsightsBucket): string[] {
  const buckets: string[] = [];
  for (
    let date = bucketOf(period.from, bucket);
    date <= period.to;
    date = bucketOf(addDays(date, bucket === "week" ? 7 : bucket === "month" ? 31 : 1), bucket)
  ) {
    buckets.push(date);
  }
  return buckets;
}
