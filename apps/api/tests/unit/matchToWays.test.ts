import { describe, expect, it } from "vitest";
import { averagePoints } from "../../src/processing/averagePoints";
import { keptPoints } from "../../src/processing/keptPoint";
import { LocalProjection } from "../../src/processing/localProjection";
import type { MapData, OsmWay, WayClass } from "../../src/processing/mapData";
import { matchToWays } from "../../src/processing/matchToWays";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { WayGraph } from "../../src/processing/wayGraph";
import { WayIndex } from "../../src/processing/wayIndex";
import { morning, motorwayDrive } from "../support/journeys";
import { throughOsmWays } from "../support/storedMap";
import {
  distanceToLine,
  motorwayLine,
  toLonLat,
  toXY,
  travel,
  type Vertex,
  worldMap,
} from "../support/syntheticWorld";

const classes: readonly WayClass[] = ["rail", "tram", "street", "ferry"];

function match(points: readonly RawPoint[], map: MapData, stored: (map: MapData) => MapData) {
  const kept = keptPoints(points, averagePoints(points, defaultProcessingConfig.averaging));
  const index = new WayIndex(stored(map), LocalProjection.around(kept));
  const graphs = Object.fromEntries(
    classes.map((name) => [name, new WayGraph(index, name)]),
  ) as Record<WayClass, WayGraph>;
  return { kept, mapped: matchToWays(kept, { index, graphs }, defaultProcessingConfig.mapping) };
}

let nextNode = 1;
/** A way through `vertices`, its nodes shared with other ways at equal positions through `nodes`. */
function way(
  id: number,
  kind: OsmWay["kind"],
  vertices: readonly Vertex[],
  nodes: Map<string, number>,
): OsmWay {
  return {
    id,
    kind,
    name: null,
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

describe.each([
  ["as Overpass sends it", (map: MapData) => map],
  ["after the compact geometry of osm_ways", throughOsmWays],
])("matchToWays, map data %s", (_, stored) => {
  it("snaps a drive to the motorway, within a few metres of the noise", () => {
    const { mapped } = match(motorwayDrive(), worldMap(), stored);
    expect(mapped.every((point) => point.wayKind === "motorway")).toBe(true);
    for (const point of mapped) {
      expect(point.snapM ?? 99).toBeLessThan(15);
      expect(
        distanceToLine(toXY({ lat: point.lat ?? 0, lon: point.lon ?? 0 }), motorwayLine),
      ).toBeLessThan(0.5);
    }
  });

  it("leaves points far from every way where they are, as other", () => {
    const field = travel(
      [
        [-20_000, -20_000],
        [-19_000, -20_000],
      ],
      { startT: morning, speedMs: 1.4, intervalS: 2 },
    );
    const { kept, mapped } = match(field, worldMap(), stored);
    for (const [position, point] of mapped.entries()) {
      expect(point.wayKind).toBe("other");
      expect(point.wayId).toBeNull();
      expect(point.lat).toBe(kept[position]?.lat);
    }
  });

  it("keeps a train on the rails across a level crossing", () => {
    const nodes = new Map<string, number>();
    const rail: Vertex[] = [
      [0, 0],
      [1000, 0],
      [2000, 0],
    ];
    const map: MapData = {
      ways: [
        way(1, "rail", rail, nodes),
        // The road crosses the railway at (1000, 0): they share that node.
        way(
          2,
          "residential",
          [
            [1000, -1000],
            [1000, 0],
            [1000, 1000],
          ],
          nodes,
        ),
      ],
      pois: [],
    };
    const train = travel(rail, {
      startT: morning,
      speedMs: 30,
      intervalS: 2,
      noiseM: 4,
      accuracy: 10,
    });
    const { mapped } = match(train, map, stored);
    expect(mapped.map((point) => point.wayKind)).toEqual(mapped.map(() => "rail"));
  });

  it("follows the streets between points far apart, round the corner", () => {
    const nodes = new Map<string, number>();
    const map: MapData = {
      ways: [
        way(
          10,
          "residential",
          [
            [0, 0],
            [400, 0],
            [800, 0],
          ],
          nodes,
        ),
        way(
          11,
          "residential",
          [
            [800, 0],
            [800, 400],
            [800, 800],
          ],
          nodes,
        ),
      ],
      pois: [],
    };
    const [startLon, startLat] = toLonLat(0, 2);
    const [endLon, endLat] = toLonLat(802, 800);
    const point = (t: number, lat: number, lon: number): RawPoint => ({
      t,
      lat,
      lon,
      accuracy: 8,
      speed: 8,
      altitude: null,
      verticalAccuracy: null,
      motion: [],
    });
    const { mapped } = match(
      [point(morning, startLat, startLon), point(morning + 200, endLat, endLon)],
      map,
      stored,
    );
    const corner = mapped[1]?.path ?? [];
    // The line runs along both streets through the corner at (800, 0), not diagonally.
    expect(corner.map(([lon, lat]) => toXY({ lat, lon }).map(Math.round))).toContainEqual([800, 0]);
    expect(mapped.map((entry) => entry.wayId)).toEqual([10, 11]);
  });

  it("gives every point of a move a place, and the first one no path", () => {
    const points = motorwayDrive().slice(0, 120);
    const { mapped } = match(points, worldMap(), stored);
    expect(mapped).toHaveLength(points.length);
    expect(mapped[0]?.path).toBeNull();
  });
});
