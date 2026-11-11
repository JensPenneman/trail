import { wayKinds } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import { LocalProjection } from "../../src/processing/localProjection";
import type { MapData, OsmWay } from "../../src/processing/mapData";
import { WayGraph } from "../../src/processing/wayGraph";
import { allKinds, kindBits, WayIndex } from "../../src/processing/wayIndex";
import { toLonLat, type Vertex } from "../support/syntheticWorld";

const projection = new LocalProjection(51, 3.7);
let nextNode = 1;
const nodes = new Map<string, number>();

function way(
  id: number,
  kind: OsmWay["kind"],
  vertices: readonly Vertex[],
  service?: string,
): OsmWay {
  return {
    id,
    kind,
    name: null,
    ...(service === undefined ? {} : { service }),
    nodes: vertices.map(([x, y]) => {
      const key = `${x}:${y}`;
      let node = nodes.get(key);
      if (node === undefined) {
        node = nextNode;
        nextNode += 1;
        nodes.set(key, node);
      }
      return node;
    }),
    geometry: vertices.map(([x, y]) => toLonLat(x, y)),
  };
}

// A railway, a road 30 m beside it, and a light rail line that continues the railway.
const map: MapData = {
  ways: [
    way(1, "rail", [
      [0, 0],
      [1000, 0],
    ]),
    way(2, "secondary", [
      [0, 30],
      [1000, 30],
    ]),
    way(
      3,
      "light_rail",
      [
        [1000, 0],
        [2000, 0],
      ],
      "spur",
    ),
    way(4, "rail", [
      [2000, 0],
      [3000, 0],
    ]),
  ],
  pois: [],
};

describe("WayIndex kind mask", () => {
  const index = new WayIndex(map, projection);
  const at = (lon: number, lat: number) => [projection.x(lon), projection.y(lat)] as const;
  const [x, y] = at(...toLonLat(500, 20));

  it("offers every kind without a mask, the nearest first", () => {
    expect(index.candidates(x, y, 100, 6).map((c) => index.ways[c.way]?.kind)).toEqual([
      "secondary",
      "rail",
    ]);
    expect(index.candidates(x, y, 100, 6, allKinds)).toEqual(index.candidates(x, y, 100, 6));
  });

  it("offers only the kinds of the mask, however much nearer the others lie", () => {
    const found = index.candidates(x, y, 100, 6, kindBits.rail);
    expect(found.map((c) => index.ways[c.way]?.id)).toEqual([1]);
    const both = index.candidates(x, y, 100, 6, kindBits.rail | kindBits.secondary);
    expect(both).toHaveLength(2);
    expect(index.candidates(x, y, 100, 6, 0)).toEqual([]);
  });

  it("has a bit for every kind", () => {
    expect(allKinds).toBe(2 ** wayKinds.length - 1);
  });

  it("keeps the service tag of a way, null when untagged", () => {
    expect(index.ways.map((w) => [w.id, w.service])).toEqual([
      [1, null],
      [2, null],
      [3, "spur"],
      [4, null],
    ]);
  });
});

describe("WayGraph kind filter", () => {
  const index = new WayIndex(map, projection);
  const first = index.candidates(
    projection.x(toLonLat(500, 0)[0]),
    projection.y(toLonLat(500, 0)[1]),
    5,
    1,
    kindBits.rail,
  )[0];
  const last = index.candidates(
    projection.x(toLonLat(2500, 0)[0]),
    projection.y(toLonLat(2500, 0)[1]),
    5,
    1,
    kindBits.rail,
  )[0];

  it("routes over every way of the class without a filter", () => {
    const graph = new WayGraph(index, "rail");
    if (first === undefined || last === undefined) throw new Error("no candidates");
    graph.search(first, [last], 5000, 10);
    expect(graph.distanceTo(last)).toBeCloseTo(2000, -1);
  });

  it("leaves the other kinds out: no route over the light rail", () => {
    const graph = new WayGraph(index, "rail", ["rail"]);
    if (first === undefined || last === undefined) throw new Error("no candidates");
    graph.search(first, [last], 5000, 10);
    expect(graph.distanceTo(last)).toBe(Number.POSITIVE_INFINITY);
    expect(graph.pathTo(last)).toBeNull();
  });
});
