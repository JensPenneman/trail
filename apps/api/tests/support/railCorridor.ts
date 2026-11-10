import type { MapData, OsmWay } from "../../src/processing/mapData";
import { toLonLat, type Vertex } from "./syntheticWorld";

/**
 * A long synthetic corridor for the performance bounds of the rail alignment:
 * a double-track line (4.5 m apart) from x = 0 to `lengthM`, a road 40 m beside
 * it for the whole length, and every `stationEveryM` a six-track station (four
 * tracks fanning out of the second main track and back, a yard beside them).
 * Ways are cut every 5 km, as OSM cuts them at speed changes and bridges.
 */
export function railCorridor(lengthM: number, stationEveryM: number): MapData {
  const ways: OsmWay[] = [];
  const nodes = new Map<string, number>();
  let nextNode = 3_000_000_000;
  let nextWay = 300_000_000;
  const nodeAt = ([x, y]: Vertex): number => {
    const key = `${x.toFixed(3)}:${y.toFixed(3)}`;
    let id = nodes.get(key);
    if (id === undefined) {
      id = nextNode;
      nextNode += 1;
      nodes.set(key, id);
    }
    return id;
  };
  const add = (kind: OsmWay["kind"], vertices: readonly Vertex[], service?: string) => {
    ways.push({
      id: nextWay,
      kind,
      nodes: vertices.map(nodeAt),
      geometry: vertices.map(([x, y]) => toLonLat(x, y)),
      name: null,
      ...(service === undefined ? {} : { service }),
    });
    nextWay += 1;
  };
  const stretch = (y: number, from: number, to: number): Vertex[] => {
    const vertices: Vertex[] = [];
    for (let x = from; x < to; x += 250) vertices.push([x, y]);
    vertices.push([to, y]);
    return vertices;
  };
  // Cut at every 5 km and at the points where a station's tracks leave and join.
  const cuts = new Set<number>([0, lengthM]);
  for (let x = 5000; x < lengthM; x += 5000) cuts.add(x);
  for (let x = stationEveryM; x + 1000 < lengthM; x += stationEveryM) {
    cuts.add(x - 800);
    cuts.add(x + 800);
  }
  const ordered = [...cuts].sort((a, b) => a - b);
  for (const y of [0, 4.5]) {
    for (let index = 1; index < ordered.length; index += 1) {
      add("rail", stretch(y, ordered[index - 1] ?? 0, ordered[index] ?? 0));
    }
  }
  add("secondary", stretch(-40, 0, lengthM));
  for (let x = stationEveryM; x + 1000 < lengthM; x += stationEveryM) {
    for (const y of [9, 13.5, 18, 22.5]) {
      add("rail", [
        [x - 800, 4.5],
        [x - 700, y],
        [x + 700, y],
        [x + 800, 4.5],
      ]);
    }
    add(
      "rail",
      [
        [x - 800, 4.5],
        [x - 700, 27],
        [x + 500, 27],
      ],
      "yard",
    );
  }
  return { ways, pois: [] };
}
