import type { WayKind } from "@trail/contracts/transport";

/** A named way with the metres travelled on it and the centre of its bounding box. */
export interface NamedWay {
  name: string;
  kind: WayKind;
  metres: number;
  lat: number;
  lon: number;
  /** The moves (their indexes in the period's list) that were on it. */
  moves: readonly number[];
}

export interface WayGroup {
  name: string;
  kind: WayKind;
  metres: number;
  /** The metre-weighted centre of the group's ways. */
  lat: number;
  lon: number;
  /** How many moves were on any of its ways. */
  moves: number;
}

/**
 * The zoom of the cells that keep apart roads of the same name: about 10 km wide at 51° N, so the
 * same name in villages 20 km apart is two roads, and in neighbouring villages one.
 */
const groupZoom = 12;

function cellOf(lat: number, lon: number): { x: number; y: number } {
  const n = 2 ** groupZoom;
  const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/**
 * The ways of one name made into roads: the ways of a name in the same cell, or in cells touching
 * (also diagonally), are one road; "Rue de la Gare" in two towns stays two. Longest first, then by
 * name and position, so the order is the same on every request.
 */
export function groupWays(ways: readonly NamedWay[]): WayGroup[] {
  const byName = new Map<string, NamedWay[]>();
  for (const way of ways) byName.set(way.name, [...(byName.get(way.name) ?? []), way]);
  const groups: WayGroup[] = [];
  for (const [name, named] of byName) {
    const cells = named.map((way) => cellOf(way.lat, way.lon));
    const parent = named.map((_, index) => index);
    const find = (index: number): number => {
      let root = index;
      while (parent[root] !== root) root = parent[root] ?? root;
      parent[index] = root;
      return root;
    };
    const seen = new Map<string, number>();
    for (const [index, cell] of cells.entries()) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const other = seen.get(`${cell.x + dx}/${cell.y + dy}`);
          if (other !== undefined) parent[find(index)] = find(other);
        }
      }
      seen.set(`${cell.x}/${cell.y}`, index);
    }
    const roads = new Map<number, NamedWay[]>();
    for (const [index, way] of named.entries()) {
      const root = find(index);
      roads.set(root, [...(roads.get(root) ?? []), way]);
    }
    for (const members of roads.values()) {
      const metres = members.reduce((sum, way) => sum + way.metres, 0);
      const longest = members.reduce((best, way) => (way.metres > best.metres ? way : best));
      groups.push({
        name,
        kind: longest.kind,
        metres,
        lat: members.reduce((sum, way) => sum + way.lat * way.metres, 0) / metres,
        lon: members.reduce((sum, way) => sum + way.lon * way.metres, 0) / metres,
        moves: new Set(members.flatMap((way) => way.moves)).size,
      });
    }
  }
  return groups.sort(
    (a, b) => b.metres - a.metres || a.name.localeCompare(b.name) || a.lat - b.lat || a.lon - b.lon,
  );
}
