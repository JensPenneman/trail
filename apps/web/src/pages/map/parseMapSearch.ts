import type { HistorySelection } from "./history/HistorySelection";
import { parseHistorySelection } from "./history/parseHistorySelection";
import { isMapView, type MapView } from "./mapViews";
import { me } from "./me";

/** What the People page's map shows, as its URL says (`/?view=…&person=…&devices=…&date=…`). */
export interface MapSearch {
  view: MapView;
  /** `me` or the user id of the one person selected; null is the overview, nobody selected. */
  person: string | null;
  /** The devices shown of the selected person; null shows all of them. */
  devices: readonly string[] | null;
  /** A level of the sidebar below the root (`?list=hidden`); only where nobody is selected. */
  list: "hidden" | null;
  /** The History view's day or period (kept while another view is shown). */
  period: Omit<HistorySelection, "deviceIds">;
}

const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isPerson = (value: string): boolean => value === me || userId.test(value);

/**
 * The person selected. `?person=` is the one parameter; links from before the
 * single selection still work: `?people=` with one person selects them (several
 * mean the overview), and `?segment=` alone is a link to one of one's own moves.
 */
function parsePerson(params: URLSearchParams): string | null {
  const person = (params.get("person") ?? "").trim().toLowerCase();
  if (isPerson(person)) return person;
  const people = [
    ...new Set(
      (params.get("people") ?? "")
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(isPerson),
    ),
  ];
  if (people.length > 0) return people.length === 1 ? (people[0] ?? null) : null;
  return params.has("segment") ? me : null;
}

/**
 * Reads the People page's URL defensively, like History always did: an
 * unknown view is Live, a hand-edited or outdated link falls back to defaults
 * instead of an error. Other parameters (`level`, `style`) belong to their
 * controls.
 */
export function parseMapSearch(params: URLSearchParams, today: string): MapSearch {
  const view = params.get("view");
  const { deviceIds, ...period } = parseHistorySelection(params, today);
  const person = parsePerson(params);
  return {
    view: isMapView(view) ? view : "live",
    person,
    list: person === null && params.get("list") === "hidden" ? "hidden" : null,
    devices: deviceIds,
    period,
  };
}
