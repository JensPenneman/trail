import { daysBetween } from "../../time/daysBetween";
import { maxRangeDays } from "./history/parseHistorySelection";
import type { MapView } from "./mapViews";

/*
 * The changes the map's controls make to the People page's URL. Each keeps
 * every other parameter, so a view, a day or a selection survives switching
 * back and forth.
 */

export function withView(params: URLSearchParams, view: MapView): URLSearchParams {
  const next = new URLSearchParams(params);
  // Heat's device filter is one's own devices' with nobody selected: it does not follow to the
  // other views, where `?devices=` alone would imply Me.
  const selecting = params.has("person") || params.has("people") || params.has("segment");
  if (params.get("view") === "heat" && view !== "heat" && !selecting) next.delete("devices");
  // A period of Heat longer than History reads is Heat's alone: it does not follow to the others.
  const from = params.get("from");
  const to = params.get("to");
  if (params.get("view") === "heat" && view !== "heat" && from !== null && to !== null) {
    try {
      if (Math.abs(daysBetween(from, to)) >= maxRangeDays) {
        next.delete("from");
        next.delete("to");
      }
    } catch {
      // Not dates: History reads them as nothing.
    }
  }
  if (view === "live") next.delete("view");
  else next.set("view", view);
  return next;
}

/** The devices shown; null (all of them) leaves the parameter out. */
export function withDevices(
  params: URLSearchParams,
  deviceIds: readonly string[] | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (deviceIds === null) next.delete("devices");
  else next.set("devices", deviceIds.join(","));
  return next;
}

/**
 * Selects someone, or nobody (null: the overview). The device filter belongs
 * to one person and goes; so do the legacy `people` and a move opened by link.
 */
export function withPerson(params: URLSearchParams, person: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("people");
  next.delete("devices");
  next.delete("segment");
  next.delete("list");
  if (person === null) next.delete("person");
  else next.set("person", person);
  return next;
}

/** A level of the sidebar below the root or below Me's page (`hidden`, `devices`), or none (null). */
export function withList(
  params: URLSearchParams,
  list: "hidden" | "devices" | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (list === null) next.delete("list");
  else next.set("list", list);
  return next;
}

/** One day of History; today leaves the date out. */
export function withDay(params: URLSearchParams, date: string, today: string): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("from");
  next.delete("to");
  if (date === today) next.delete("date");
  else next.set("date", date);
  return next;
}

/** A period of History. */
export function withRange(params: URLSearchParams, from: string, to: string): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("date");
  next.set("from", from);
  next.set("to", to);
  return next;
}

/**
 * The period of Heat's time and visits, shared with History's range; `null` is all time and drops
 * both. A chosen day (`date`) stays: it is History's.
 */
export function withHeatPeriod(
  params: URLSearchParams,
  period: { from: string; to: string } | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (period === null) {
    next.delete("from");
    next.delete("to");
  } else {
    next.set("from", period.from);
    next.set("to", period.to);
  }
  return next;
}

/** The camera a link named, once the map has left it. */
export function withoutCamera(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("c");
  return next;
}

/** The lens Insights set on Heat taken off: the measure, the period and (D2) the mode, together. */
export function withoutLens(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of ["heat", "from", "to", "mode"]) next.delete(name);
  return next;
}
