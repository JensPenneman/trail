import type { HistorySelection } from "./history/HistorySelection";
import { parseHistorySelection } from "./history/parseHistorySelection";
import { isMapView, type MapView } from "./mapViews";
import { me } from "./me";

/** What the People page's map shows, as its URL says (`/?view=…&people=…&devices=…&date=…`). */
export interface MapSearch {
  view: MapView;
  /** `me` and the user ids of people sharing with the signed-in person; never empty. */
  people: readonly string[];
  /** The devices shown; null shows every device of the selected people. */
  devices: readonly string[] | null;
  /** The History view's day or period (kept while another view is shown). */
  period: Omit<HistorySelection, "deviceIds">;
}

const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `?people=` as written, without what cannot be a person; Me when nobody is left. */
export function parsePeople(params: URLSearchParams): readonly string[] {
  const people = (params.get("people") ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part === me || userId.test(part));
  return people.length === 0 ? [me] : [...new Set(people)];
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
  return {
    view: isMapView(view) ? view : "live",
    people: parsePeople(params),
    devices: deviceIds,
    period,
  };
}
