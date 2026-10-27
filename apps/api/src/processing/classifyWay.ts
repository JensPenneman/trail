import type { WayKind } from "@trail/contracts/transport";
import { ownEntry } from "../lib/ownEntry";

const railways: Readonly<Record<string, WayKind>> = {
  rail: "rail",
  narrow_gauge: "rail",
  funicular: "rail",
  light_rail: "light_rail",
  tram: "tram",
  subway: "subway",
};

const highways: Readonly<Record<string, WayKind>> = {
  motorway: "motorway",
  motorway_link: "motorway",
  trunk: "trunk",
  trunk_link: "trunk",
  primary: "primary",
  primary_link: "primary",
  secondary: "secondary",
  secondary_link: "secondary",
  tertiary: "tertiary",
  tertiary_link: "tertiary",
  unclassified: "tertiary",
  residential: "residential",
  living_street: "residential",
  service: "service",
  busway: "service",
  track: "track",
  cycleway: "cycleway",
  footway: "footway",
  pedestrian: "footway",
  steps: "footway",
  corridor: "footway",
  platform: "footway",
  path: "path",
  bridleway: "path",
};

/** Lifecycle values of `highway` that are no road (yet, or any more). */
const notBuilt = new Set(["proposed", "construction", "abandoned", "razed", "disused", "planned"]);

/**
 * The way kind of an OSM way from its tags, or null when nobody travels on it.
 * A railway wins over a highway tag (a tram through a pedestrian street), a
 * ferry route over both.
 */
export function classifyWay(tags: Readonly<Record<string, string>>): WayKind | null {
  const railway = tags["railway"];
  if (railway !== undefined) {
    const kind = ownEntry(railways, railway);
    if (kind !== undefined) return kind;
  }
  if (tags["route"] === "ferry") return "ferry";
  const highway = tags["highway"];
  if (highway === undefined || notBuilt.has(highway)) return null;
  return ownEntry(highways, highway) ?? "other";
}
