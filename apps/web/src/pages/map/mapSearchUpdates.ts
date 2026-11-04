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

/** A level of the sidebar below the root (`hidden`), or the root (null). */
export function withList(params: URLSearchParams, list: "hidden" | null): URLSearchParams {
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
