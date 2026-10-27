import type { MapView } from "./mapViews";
import { me } from "./me";
import { parsePeople } from "./parseMapSearch";

/*
 * The changes the map's controls make to the People page's URL. Each keeps
 * every other parameter, so a view, a day or a selection survives switching
 * back and forth.
 */

export function withView(params: URLSearchParams, view: MapView): URLSearchParams {
  const next = new URLSearchParams(params);
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
 * Other people. A device filter in place keeps applying to the people who
 * stay; someone who joins shows all their devices, someone who leaves takes
 * theirs along, and a filter that ends up covering everything is dropped.
 */
export function withPeople(
  params: URLSearchParams,
  people: readonly string[],
  devicesOf: (person: string) => readonly string[],
): URLSearchParams {
  const next = new URLSearchParams(params);
  const before = parsePeople(params);
  const filter = params.get("devices");
  if (filter !== null && filter !== "") {
    const leaving = new Set(before.filter((person) => !people.includes(person)).flatMap(devicesOf));
    const joining = people.filter((person) => !before.includes(person)).flatMap(devicesOf);
    const kept = filter.split(",").filter((id) => id !== "" && !leaving.has(id));
    const devices = [...new Set([...kept, ...joining])];
    const everything = people.flatMap(devicesOf).every((id) => devices.includes(id));
    if (devices.length === 0 || everything) next.delete("devices");
    else next.set("devices", devices.join(","));
  }
  if (people.length === 1 && people[0] === me) next.delete("people");
  else next.set("people", people.join(","));
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
