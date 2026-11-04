import { type HeatMeasure, heatMeasures } from "@trail/contracts/heatmap";
import { lastInsightsDay } from "@trail/contracts/period";
import { parseLocalDate } from "../../time/parseLocalDate";
import type { HistorySelection } from "./history/HistorySelection";
import { parseHistorySelection } from "./history/parseHistorySelection";
import { isMapView, type MapView } from "./mapViews";
import { me } from "./me";

/** Where the map looks (`?c=lon,lat,zoom`), as a link names it. */
export interface MapCamera {
  lon: number;
  lat: number;
  zoom: number;
}

/** The latitude Web Mercator reaches. */
const maxLatitude = 85.0511;
const maxCameraZoom = 22;
const plainNumber = /^-?\d+(\.\d+)?$/;

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * `c=<lon>,<lat>,<zoom>`, read defensively: three plain numbers within the world and the zooms the
 * map has, else nothing (the camera is then the page's own).
 */
export function parseCamera(value: string | null): MapCamera | null {
  const parts = value?.split(",") ?? [];
  if (parts.length !== 3 || !parts.every((part) => plainNumber.test(part))) return null;
  const [lon, lat, zoom] = parts.map(Number) as [number, number, number];
  if (Math.abs(lon) > 180 || Math.abs(lat) > maxLatitude) return null;
  if (zoom < 0 || zoom > maxCameraZoom) return null;
  // As precise as the address is written (about a metre, a hundredth of a zoom): more is rounded.
  return { lon: round(lon, 5), lat: round(lat, 5), zoom: round(zoom, 2) };
}

/**
 * The period of Heat's time and visits (`?from=&to=`, shared with History): both dates, in order,
 * not after today, at most three years (Insights'), else all time. A range History clamps to 93
 * days is Heat's up to the three years.
 */
export function parseHeatPeriod(
  params: URLSearchParams,
  today: string,
): { from: string; to: string } | null {
  const read = (name: string): string | null => {
    const value = params.get(name);
    if (value === null || parseLocalDate(value) === null) return null;
    return value > today ? today : value;
  };
  const a = read("from");
  const b = read("to");
  if (a === null || b === null) return null;
  const [from, to] = a <= b ? [a, b] : [b, a];
  const last = lastInsightsDay(from);
  // biome-ignore lint/complexity/useMathMinMax: dates are strings, which Math.min cannot compare
  return { from, to: to > last ? last : to };
}

/** What the People page's map shows, as its URL says (`/?view=…&person=…&devices=…&date=…`). */
export interface MapSearch {
  view: MapView;
  /** `me` or the user id of the one person selected; null is the overview, nobody selected. */
  person: string | null;
  /** The devices shown of the selected person; null shows all of them. */
  devices: readonly string[] | null;
  /**
   * A level of the sidebar below the root: `hidden` where nobody is selected,
   * `devices` on Me's page (`?person=me&list=devices`).
   */
  list: "hidden" | "devices" | null;
  /** The History view's day or period (kept while another view is shown). */
  period: Omit<HistorySelection, "deviceIds">;
  /** What Heat counts, when the address says; null leaves it to the remembered choice and the preference. */
  heat: HeatMeasure | null;
  /** The period of Heat's time and visits; null: all time. */
  heatPeriod: { from: string; to: string } | null;
  /** Where the link looks, once; null: the page chooses. */
  camera: MapCamera | null;
}

/** A measure Heat counts, or null for anything else (the address is read defensively). */
export function parseHeatMeasure(value: string | null): HeatMeasure | null {
  return (heatMeasures as readonly (string | null)[]).includes(value)
    ? (value as HeatMeasure)
    : null;
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

/** The level named by `?list=`, where it can be: Hidden at the root, the devices on Me's page. */
function parseList(person: string | null, value: string | null): "hidden" | "devices" | null {
  if (person === null && value === "hidden") return "hidden";
  if (person === me && value === "devices") return "devices";
  return null;
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
    list: parseList(person, params.get("list")),
    devices: deviceIds,
    period,
    heat: parseHeatMeasure(params.get("heat")),
    heatPeriod: parseHeatPeriod(params, today),
    camera: parseCamera(params.get("c")),
  };
}
