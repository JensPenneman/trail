import { lastInsightsDay } from "@trail/contracts/insights";
import { type TransportMode, transportModes } from "@trail/contracts/transport";
import type { InsightsParams } from "../../api/queryKeys";
import type { Formatter } from "../../format/createFormatter";
import { addDays } from "../../time/addDays";
import { daysBetween } from "../../time/daysBetween";
import { parseLocalDate } from "../../time/parseLocalDate";
import { shiftMonth } from "../../time/shiftMonth";

/** The units a period is chosen in; "all" is the whole history. */
export const periodUnits = ["week", "month", "year", "all"] as const;
export type PeriodUnit = (typeof periodUnits)[number];
type CalendarUnit = Exclude<PeriodUnit, "all">;

/**
 * What the Insights screens cover: a calendar week (Monday first, as the
 * API's series are), month or year — `current` when it holds today, so that
 * it ends at today instead of at its last day — the whole history, or a
 * custom range of days (which the old rolling periods become).
 */
export interface CalendarPeriod {
  kind: CalendarUnit;
  first: string;
  last: string;
  current: boolean;
}
export type InsightsPeriod =
  | { kind: "all" }
  | CalendarPeriod
  | { kind: "custom"; first: string; last: string };

/** What an Insights address says: the period, the devices counted and the mode of the screens that filter by one. */
export interface InsightsAddress {
  period: InsightsPeriod;
  /** The devices counted; null for all of them. */
  devices: readonly string[] | null;
  /** The mode of the screens that filter by one; null for every mode. */
  mode: TransportMode | null;
}

const deviceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The earliest year an address may name: older than anything a phone has recorded. */
const firstYear = 1970;

/** The rolling periods that links of before the calendar periods used; read as custom ranges, never written. */
const rolling = { "7d": 7, "30d": 30, "90d": 90 } as const;

/** Whether `from..to` is a period the API takes: real dates, in order, three years at most. */
export function isInsightsRange(from: string, to: string): boolean {
  return (
    parseLocalDate(from) !== null &&
    parseLocalDate(to) !== null &&
    from <= to &&
    to <= lastInsightsDay(from)
  );
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Monday is 0. */
function weekdayIndex(date: string): number {
  const parsed = parseLocalDate(date);
  if (parsed === null) throw new RangeError(`Not a calendar date: ${date}`);
  return (new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay() + 6) % 7;
}

/** The ISO week a date belongs to: the year its Thursday lies in, and its number there. */
function isoWeekOf(date: string): { year: number; week: number } {
  const thursday = addDays(addDays(date, -weekdayIndex(date)), 3);
  const year = Number(thursday.slice(0, 4));
  return { year, week: Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1 };
}

/** The week, month or year that holds `anchor`. */
export function calendarPeriod(unit: CalendarUnit, anchor: string, today: string): CalendarPeriod {
  let first: string;
  let last: string;
  if (unit === "week") {
    first = addDays(anchor, -weekdayIndex(anchor));
    last = addDays(first, 6);
  } else if (unit === "month") {
    first = `${anchor.slice(0, 7)}-01`;
    last = addDays(shiftMonth(first, 1), -1);
  } else {
    first = `${anchor.slice(0, 4)}-01-01`;
    last = `${anchor.slice(0, 4)}-12-31`;
  }
  return { kind: unit, first, last, current: first <= today && today <= last };
}

/** Nothing in the address: this month. */
export const defaultPeriod = (today: string): InsightsPeriod =>
  calendarPeriod("month", today, today);

/** `2026-W44` as the Monday it starts on; null for a week the year does not have (W53 only in some years). */
function weekStart(text: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (year < firstYear || week < 1) return null;
  const january4 = `${year}-01-04`;
  const first = addDays(january4, -weekdayIndex(january4) + (week - 1) * 7);
  const found = isoWeekOf(first);
  return found.year === year && found.week === week ? first : null;
}

/** The period a `period=` value names, or null when it names none. */
function parsePeriodValue(value: string, today: string): InsightsPeriod | null {
  if (value === "all") return { kind: "all" };
  if (value === "week" || value === "month" || value === "year") {
    return calendarPeriod(value, today, today);
  }
  if (Object.hasOwn(rolling, value)) {
    const days = rolling[value as keyof typeof rolling];
    return { kind: "custom", first: addDays(today, 1 - days), last: today };
  }
  let period: CalendarPeriod | null = null;
  const week = weekStart(value);
  if (week !== null) period = calendarPeriod("week", week, today);
  else if (/^\d{4}-\d{2}$/.test(value) && parseLocalDate(`${value}-01`) !== null) {
    period = calendarPeriod("month", `${value}-01`, today);
  } else if (/^\d{4}$/.test(value)) period = calendarPeriod("year", `${value}-01-01`, today);
  // The future has nothing to show; a year before phones is a typo.
  return period !== null && period.first <= today && Number(period.first.slice(0, 4)) >= firstYear
    ? period
    : null;
}

/**
 * Reads the address defensively, like the People page does: a period it does
 * not know is this month, a custom range that the API would refuse too, and
 * devices or a mode that cannot be one are dropped.
 */
export function parseInsightsAddress(params: URLSearchParams, today: string): InsightsAddress {
  const from = params.get("from");
  const to = params.get("to");
  const custom: InsightsPeriod | null =
    from !== null && to !== null && isInsightsRange(from, to)
      ? { kind: "custom", first: from, last: to }
      : null;
  const named = params.get("period");
  const devices = (params.get("devices") ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => deviceId.test(part));
  const mode = params.get("mode");
  return {
    period:
      custom ?? (named === null ? null : parsePeriodValue(named, today)) ?? defaultPeriod(today),
    devices: devices.length === 0 ? null : [...new Set(devices)],
    mode: (transportModes as readonly (string | null)[]).includes(mode)
      ? (mode as TransportMode)
      : null,
  };
}

/** The local days of a period as the API takes them: a current one ends today, all of it leaves `from` to the server. */
export function periodRange(
  period: InsightsPeriod,
  today: string,
): { from: string | null; to: string } {
  if (period.kind === "all") return { from: null, to: today };
  const current = period.kind !== "custom" && period.current;
  return { from: period.first, to: current ? today : period.last };
}

/** The request of a screen; `withMode` for the screens that filter by a mode. */
export function insightsParams(
  address: InsightsAddress,
  today: string,
  withMode = false,
): InsightsParams {
  return {
    ...periodRange(address.period, today),
    deviceIds: address.devices,
    mode: withMode ? address.mode : null,
  };
}

/** The address of a period: this month leaves the parameter out, a current one is named by its unit, any other by its dates. */
function periodValue(period: InsightsPeriod): string | null {
  switch (period.kind) {
    case "all":
      return "all";
    case "custom":
      return null;
    case "month":
      return period.current ? null : period.first.slice(0, 7);
    case "year":
      return period.current ? "year" : period.first.slice(0, 4);
    case "week": {
      if (period.current) return "week";
      const { year, week } = isoWeekOf(period.first);
      return `${year}-W${pad(week)}`;
    }
  }
}

/** The parameters after choosing a period; the devices and the mode stay. */
export function withPeriod(current: URLSearchParams, period: InsightsPeriod): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("period");
  next.delete("from");
  next.delete("to");
  if (period.kind === "custom") {
    next.set("from", period.first);
    next.set("to", period.last);
  } else {
    const value = periodValue(period);
    if (value !== null) next.set("period", value);
  }
  return next;
}

/** The parameters after choosing devices (null: all of them, left out). */
export function withDevices(
  current: URLSearchParams,
  devices: readonly string[] | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (devices === null) next.delete("devices");
  else next.set("devices", devices.join(","));
  return next;
}

/** The period before or after a calendar one; null where there is none (after the current one, and for the others). */
export function stepPeriod(
  period: InsightsPeriod,
  direction: -1 | 1,
  today: string,
): CalendarPeriod | null {
  if (period.kind === "all" || period.kind === "custom") return null;
  if (direction === -1) {
    const before = addDays(period.first, -1);
    return Number(before.slice(0, 4)) < firstYear
      ? null
      : calendarPeriod(period.kind, before, today);
  }
  const after = addDays(period.last, 1);
  return after > today ? null : calendarPeriod(period.kind, after, today);
}

/**
 * The period in another unit, around the same day: the one shown ends on
 * (or today, for a current one), so a month seen in the past gives the week or
 * year that holds its last day.
 */
export function periodInUnit(
  period: InsightsPeriod,
  unit: PeriodUnit,
  today: string,
): InsightsPeriod {
  if (unit === "all") return { kind: "all" };
  const anchor =
    period.kind === "all"
      ? today
      : period.kind !== "custom" && period.current
        ? today
        : period.last < today
          ? period.last
          : today;
  return calendarPeriod(unit, anchor, today);
}

/** What a period is compared with, when it is one of the calendar: the period before, as far as this one has got. */
export interface PeriodComparison {
  /** The whole period before. */
  previous: { first: string; last: string };
  /** The days compared: all of the period before, or as many of its first days as this one has had. */
  from: string;
  to: string;
  /** The period is still going on, so only the same days of the one before count. */
  partial: boolean;
}

export function comparisonOf(period: InsightsPeriod, today: string): PeriodComparison | null {
  if (period.kind === "all" || period.kind === "custom") return null;
  const before = calendarPeriod(period.kind, addDays(period.first, -1), today);
  const partial = period.current && today < period.last;
  const elapsed = daysBetween(period.first, today) + 1;
  const to = partial ? minDate(before.last, addDays(before.first, elapsed - 1)) : before.last;
  return {
    previous: { first: before.first, last: before.last },
    from: before.first,
    to,
    partial,
  };
}

const minDate = (a: string, b: string): string => (a < b ? a : b);

const noon = (date: string): number => Date.parse(`${date}T12:00:00Z`);
const inUtc = (locale: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });

/** "12–18 Oct", "26 Oct – 1 Nov"; the year after, when asked: "26 Oct – 1 Nov 2026". */
function rangeLabel(first: string, last: string, locale: string, withYear: boolean): string {
  const dayMonth = inUtc(locale, { day: "numeric", month: "short" });
  const dayMonthYear = inUtc(locale, { day: "numeric", month: "short", year: "numeric" });
  const end = (withYear ? dayMonthYear : dayMonth).format(noon(last));
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  if (first === last) return end;
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const dayFirst = /^\d/.test(dayMonth.format(noon(last)));
  if (sameMonth && dayFirst) {
    return `${inUtc(locale, { day: "numeric" }).format(noon(first))}–${end}`;
  }
  // Across New Year the first end names its year too: "29 Dec 2025 – 4 Jan 2026".
  const start = (withYear && !sameYear ? dayMonthYear : dayMonth).format(noon(first));
  return `${start} – ${end}`;
}

/** "October 2026", "26 Oct – 1 Nov 2026", "2026", "All time", "6 Oct – 4 Nov 2026": the period on the screen. */
export function periodLabel(period: InsightsPeriod, format: Formatter): string {
  switch (period.kind) {
    case "all":
      return "All time";
    case "year":
      return period.first.slice(0, 4);
    case "month":
      return format.month(Number(period.first.slice(0, 4)), Number(period.first.slice(5, 7)));
    case "week":
    case "custom":
      return rangeLabel(period.first, period.last, format.locale, true);
  }
}

/**
 * What the comparison is with, as the end of "12% more than …": the month
 * before ("September"), the same days of it while this one goes on, the same
 * for weeks and years. The year is added when it is not the period's own.
 */
export function comparisonName(
  period: InsightsPeriod,
  comparison: PeriodComparison,
  format: Formatter,
): string {
  if (period.kind === "all" || period.kind === "custom") return "";
  const { previous, partial } = comparison;
  const otherYear = previous.first.slice(0, 4) !== period.first.slice(0, 4);
  switch (period.kind) {
    case "month": {
      const month = inUtc(format.locale, {
        month: "long",
        ...(otherYear ? { year: "numeric" as const } : {}),
      }).format(noon(previous.first));
      return partial ? `the same days of ${month}` : month;
    }
    case "week":
      return partial
        ? "the same days last week"
        : rangeLabel(previous.first, previous.last, format.locale, otherYear);
    case "year":
      return partial
        ? `the same days of ${previous.first.slice(0, 4)}`
        : previous.first.slice(0, 4);
  }
}

/** What follows "than" for a period compared with the API's `previous`: as many days just before. */
export function daysBefore(days: number): string {
  return days === 1 ? "the day before" : `the ${days} days before`;
}

/** The first and last day of the period the screen shows, for the custom form to start from. */
export function periodDays(period: InsightsPeriod, today: string): { first: string; last: string } {
  if (period.kind === "all") return { first: today, last: today };
  return {
    first: period.first,
    last: period.kind !== "custom" && period.current ? today : period.last,
  };
}

/** The period inside a sentence: "No moves in October 2026", "… in all your history". */
export function periodPhrase(period: InsightsPeriod, format: Formatter): string {
  return period.kind === "all" ? "all your history" : periodLabel(period, format);
}
