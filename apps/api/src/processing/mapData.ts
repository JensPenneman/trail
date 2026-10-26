import type { WayKind } from "@trail/contracts/transport";

/** Public transport stops and airports, by what matters to the mode rules. */
const poiKinds = [
  "station",
  "halt",
  "tram_stop",
  "subway_station",
  "bus_stop",
  "ferry_terminal",
  "aerodrome",
] as const;
export type PoiKind = (typeof poiKinds)[number];

/** An OpenStreetMap way that people travel on, with its shape. */
export interface OsmWay {
  /** OSM way id. */
  id: number;
  kind: WayKind;
  /** OSM node ids, in order; ways that share a node are connected there. */
  nodes: readonly number[];
  /** `[lon, lat]` of each node. */
  geometry: readonly (readonly [number, number])[];
  name: string | null;
}

export interface OsmPoi {
  /** `n<id>`, `w<id>` or `r<id>`: OSM element type and id. */
  id: string;
  kind: PoiKind;
  lat: number;
  lon: number;
  name: string | null;
}

/** What the map matching and the mode rules know about an area. */
export interface MapData {
  ways: readonly OsmWay[];
  pois: readonly OsmPoi[];
}

/** The networks a route can follow: a train stays on rails, a ferry on its route. */
export type WayClass = "rail" | "tram" | "street" | "ferry";

export function wayClassOf(kind: WayKind): WayClass {
  switch (kind) {
    case "rail":
    case "light_rail":
    case "subway":
      return "rail";
    case "tram":
      return "tram";
    case "ferry":
      return "ferry";
    default:
      return "street";
  }
}
