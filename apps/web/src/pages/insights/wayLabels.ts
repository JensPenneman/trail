import type { WayFamily } from "@trail/contracts/insights";
import type { WayKind } from "@trail/contracts/transport";

/** The kinds of way in words, as OpenStreetMap classes them. */
export const wayKindLabels: Readonly<Record<WayKind, string>> = {
  motorway: "Motorways",
  trunk: "Trunk roads",
  primary: "Primary roads",
  secondary: "Secondary roads",
  tertiary: "Tertiary roads",
  residential: "Residential streets",
  service: "Service roads",
  track: "Tracks",
  cycleway: "Cycleways",
  footway: "Footways",
  path: "Paths",
  rail: "Railways",
  light_rail: "Light rail",
  tram: "Tram tracks",
  subway: "Metro lines",
  ferry: "Ferry routes",
  other: "Off the map",
};

/** The families of ways in words. */
export const wayFamilyLabels: Readonly<Record<WayFamily, string>> = {
  motorway: "Motorways and trunk roads",
  road: "Other roads and streets",
  cycleway: "Cycleways",
  foot: "Footways and paths",
  rail: "Railways",
  tram: "Tram and light rail",
  subway: "Metro",
  ferry: "Ferries",
  none: "Off the map",
};
