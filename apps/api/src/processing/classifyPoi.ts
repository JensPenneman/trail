import type { PoiKind } from "./mapData";

/** The stop kind of an OSM element from its tags, or null when it is none of them. */
export function classifyPoi(tags: Readonly<Record<string, string>>): PoiKind | null {
  const railway = tags["railway"];
  if (railway === "station") {
    return tags["station"] === "subway" || tags["subway"] === "yes" ? "subway_station" : "station";
  }
  if (railway === "halt") return "halt";
  if (railway === "tram_stop") return "tram_stop";
  if (tags["highway"] === "bus_stop") return "bus_stop";
  if (tags["amenity"] === "ferry_terminal") return "ferry_terminal";
  if (tags["aeroway"] === "aerodrome") return "aerodrome";
  return null;
}
