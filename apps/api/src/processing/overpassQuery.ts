import { tileBounds } from "../heatmap/tileMath";
import type { TileAddress } from "./waySource";

/**
 * The one Overpass query per tile (docs/architecture.md §17.3): every road and
 * path except ones not built (yet or any more), the railways people ride,
 * ferry routes — with their nodes and shape — and the public transport stops
 * and airports of the tile.
 */
export function overpassQuery(tile: TileAddress): string {
  const bbox = tileBounds(tile.x, tile.y, tile.z)
    .map((value) => value.toFixed(7))
    .join(",");
  return [
    "[out:json][timeout:50];",
    "(",
    `  way["highway"]["highway"!~"^(proposed|construction|abandoned|razed|disused|planned)$"](${bbox});`,
    `  way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge|funicular)$"](${bbox});`,
    `  way["route"="ferry"](${bbox});`,
    ");",
    "out body geom;",
    "(",
    `  node["railway"~"^(station|halt|tram_stop)$"](${bbox});`,
    `  node["highway"="bus_stop"](${bbox});`,
    `  node["amenity"="ferry_terminal"](${bbox});`,
    `  nwr["aeroway"="aerodrome"](${bbox});`,
    ");",
    "out body center;",
    "",
  ].join("\n");
}
