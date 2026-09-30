import { addDays } from "../../time/addDays";
import { daysBetween } from "../../time/daysBetween";
import { parseLocalDate } from "../../time/parseLocalDate";
import type { HistorySelection } from "./HistorySelection";

/** The API's limit for one tracks request. */
export const maxRangeDays = 93;

/**
 * Reads `?date=`, or `?from=&to=`, and `?devices=` defensively: a hand-edited
 * or outdated link falls back to today instead of an error, dates in the
 * future are pulled back to today and a too-long range is shortened.
 */
export function parseHistorySelection(params: URLSearchParams, today: string): HistorySelection {
  const devicesParam = params.get("devices");
  const deviceIds =
    devicesParam === null || devicesParam === ""
      ? null
      : devicesParam.split(",").filter((id) => id !== "");
  const clamp = (date: string | null): string | null => {
    if (date === null || parseLocalDate(date) === null) return null;
    return date > today ? today : date;
  };
  const from = clamp(params.get("from"));
  const to = clamp(params.get("to"));
  if (from !== null && to !== null) {
    const [first, last] = from <= to ? [from, to] : [to, from];
    const span = daysBetween(first, last);
    return {
      mode: "range",
      from: first,
      to: span >= maxRangeDays ? addDays(first, maxRangeDays - 1) : last,
      deviceIds,
    };
  }
  const date = clamp(params.get("date")) ?? today;
  return { mode: "day", from: date, to: date, deviceIds };
}
