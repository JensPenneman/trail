import { lastInsightsDay } from "@trail/contracts/insights";
import { type TransportMode, transportModes } from "@trail/contracts/transport";
import type { InsightsParams } from "../../api/queryKeys";
import type { Formatter } from "../../format/createFormatter";
import { addDays } from "../../time/addDays";
import { parseLocalDate } from "../../time/parseLocalDate";

/** The periods to choose from; a custom period is its `from` and `to` in the address. */
export const insightsPeriods = ["7d", "30d", "90d", "year", "all"] as const;
export type InsightsPeriodChoice = (typeof insightsPeriods)[number] | "custom";
const defaultInsightsPeriod = "30d";

/** What the Insights pages show, as their address says (`?period=` or `?from=&to=`, `devices`, `mode`). */
export interface InsightsSearch {
  period: InsightsPeriodChoice;
  /** The days of a custom period; null for the others. */
  from: string | null;
  to: string | null;
  /** The devices counted; null for all of them. */
  devices: readonly string[] | null;
  /** The mode of the pages that filter by one; null for every mode. */
  mode: TransportMode | null;
}

const deviceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isPeriod = (value: string | null): value is (typeof insightsPeriods)[number] =>
  (insightsPeriods as readonly (string | null)[]).includes(value);

/** Whether `from..to` is a period the API takes: real dates, in order, three years at most. */
export function isInsightsRange(from: string, to: string): boolean {
  return (
    parseLocalDate(from) !== null &&
    parseLocalDate(to) !== null &&
    from <= to &&
    to <= lastInsightsDay(from)
  );
}

/**
 * Reads the address defensively, like the People page does: a period it does
 * not know is the default (the last 30 days), a custom period that the API
 * would refuse too, and devices or a mode that cannot be one are dropped.
 */
export function parseInsightsSearch(params: URLSearchParams): InsightsSearch {
  const from = params.get("from");
  const to = params.get("to");
  const custom = from !== null && to !== null && isInsightsRange(from, to);
  const period = params.get("period");
  const devices = (params.get("devices") ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => deviceId.test(part));
  const mode = params.get("mode");
  return {
    period: custom ? "custom" : isPeriod(period) ? period : defaultInsightsPeriod,
    from: custom ? from : null,
    to: custom ? to : null,
    devices: devices.length === 0 ? null : [...new Set(devices)],
    mode: (transportModes as readonly (string | null)[]).includes(mode)
      ? (mode as TransportMode)
      : null,
  };
}

/** The local days of the chosen period, as the API takes them; all of it leaves `from` to the server. */
export function insightsRange(
  search: InsightsSearch,
  today: string,
): { from: string | null; to: string } {
  switch (search.period) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { from: null, to: today };
    case "custom":
      return { from: search.from ?? today, to: search.to ?? today };
  }
}

/** The query of a page's request; `withMode` for the pages that filter by a mode. */
export function insightsParams(
  search: InsightsSearch,
  today: string,
  withMode = false,
): InsightsParams {
  return {
    ...insightsRange(search, today),
    deviceIds: search.devices,
    mode: withMode ? search.mode : null,
  };
}

/** The period in words, for headings and summaries: "the last 30 days", "1 Oct 2026 – 27 Oct 2026". */
export function periodPhrase(search: InsightsSearch, format: Formatter): string {
  switch (search.period) {
    case "7d":
      return "the last 7 days";
    case "30d":
      return "the last 30 days";
    case "90d":
      return "the last 90 days";
    case "year":
      return "this year";
    case "all":
      return "all your history";
    case "custom":
      return search.from === search.to
        ? format.date(search.from ?? "")
        : `${format.date(search.from ?? "")} – ${format.date(search.to ?? "")}`;
  }
}

/** What a period is compared with: the period of as many days just before it. */
export function comparisonPhrase(days: number): string {
  return days === 1 ? "the day before" : `the ${days} days before`;
}

/**
 * The address of an Insights page with the period and devices of this one
 * (and its mode, for the pages that filter by one).
 */
export function insightsLink(
  path: string,
  current: URLSearchParams,
  options: { keepMode?: boolean } = {},
): string {
  const next = new URLSearchParams();
  for (const key of ["period", "from", "to", "devices", ...(options.keepMode ? ["mode"] : [])]) {
    const value = current.get(key);
    if (value !== null) next.set(key, value);
  }
  const search = next.toString();
  return search === "" ? path : `${path}?${search}`;
}

/** The parameters after choosing a period: a preset by name (the default left out), or a custom range. */
export function withPeriod(
  current: URLSearchParams,
  choice: { period: (typeof insightsPeriods)[number] } | { from: string; to: string },
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("period");
  next.delete("from");
  next.delete("to");
  if ("period" in choice) {
    if (choice.period !== defaultInsightsPeriod) next.set("period", choice.period);
  } else {
    next.set("from", choice.from);
    next.set("to", choice.to);
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

/** The parameters after choosing a mode (null: every mode, left out). */
export function withMode(current: URLSearchParams, mode: TransportMode | null): URLSearchParams {
  const next = new URLSearchParams(current);
  if (mode === null) next.delete("mode");
  else next.set("mode", mode);
  return next;
}
