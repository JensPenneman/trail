/**
 * The OSM keys Trail keeps of a way (docs/architecture.md §17.2), whether it
 * came from Overpass or from a region's map data: what `classifyWay` reads
 * and the name.
 */
export const keptWayTags = [
  "highway",
  "railway",
  "service",
  "maxspeed",
  "name",
  "route",
  "public_transport",
  "oneway",
] as const;
