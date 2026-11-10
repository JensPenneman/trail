import { describe, expect, it } from "vitest";
import { parseOplWay } from "../../src/mapdata/parseOplWay";
import { parseRegionPoly } from "../../src/mapdata/regionPoly";
import { LocalProjection } from "../../src/processing/localProjection";
import { WayGraph } from "../../src/processing/wayGraph";
import { kindBits, WayIndex } from "../../src/processing/wayIndex";
import {
  branchLine,
  oplLinesOf,
  parallelLine,
  pathToTerminus,
  railRide,
  railWorld,
  regionPolyText,
  roadLine,
  sidingTrack,
  stationTracks,
  terminusTracks,
  trackA,
  trackB,
  yardTrack,
} from "../support/railWorld";
import { distanceToLine, toLonLat, toXY } from "../support/syntheticWorld";

const projection = new LocalProjection(51, 3.7);
const index = new WayIndex(railWorld(), projection);
const near = (x: number, y: number) => {
  const [lon, lat] = toLonLat(x, y);
  return index.candidates(projection.x(lon), projection.y(lat), 6, 1, kindBits.rail)[0];
};

describe("railWorld", () => {
  it("holds the tracks, the station, the yard and the siding, and one road", () => {
    const { ways, pois } = railWorld();
    expect(new Set(ways.map((way) => way.kind))).toEqual(new Set(["rail", "secondary"]));
    expect(ways.filter((way) => way.kind === "secondary")).toHaveLength(1);
    expect(ways.flatMap((way) => (way.service === undefined ? [] : [way.service])).sort()).toEqual([
      "crossover",
      "siding",
      "yard",
    ]);
    expect(stationTracks).toHaveLength(4);
    expect(terminusTracks).toHaveLength(4);
    expect(pois.map((poi) => poi.kind)).toEqual(["station", "station"]);
    expect(new Set(ways.map((way) => way.id)).size).toBe(ways.length);
    for (const way of ways) {
      expect(way.geometry.length).toBeGreaterThanOrEqual(2);
      expect(way.nodes).toHaveLength(way.geometry.length);
    }
  });

  it("keeps the road 40 m from the line, the second line 150 m, the station tracks 4.5 m apart", () => {
    expect(Math.min(...roadLine.map((vertex) => distanceToLine(vertex, trackA)))).toBeCloseTo(
      40,
      3,
    );
    expect(distanceToLine(parallelLine[8] ?? [0, 0], trackA)).toBeCloseTo(150, 3);
    expect(distanceToLine(trackB[40] ?? [0, 0], trackA)).toBeCloseTo(4.5, 3);
    expect(distanceToLine(stationTracks[0]?.[1] ?? [0, 0], trackB)).toBeCloseTo(4.5, 3);
    expect(yardTrack.length).toBe(3);
    expect(sidingTrack.length).toBe(3);
  });

  it("is one network: from the west end of track A to the terminus's buffer stop, over the branch", () => {
    const graph = new WayGraph(index, "rail", ["rail"]);
    const from = near(1000, 0);
    const to = near(...(terminusTracks[3]?.at(-1) ?? ([0, 0] as const)));
    if (from === undefined || to === undefined) throw new Error("not on the rails");
    graph.search(from, [to], 40_000, 400);
    // 14 km on the main line, then 9.8 km along the branch.
    expect(graph.distanceTo(to)).toBeGreaterThan(23_500);
    expect(graph.distanceTo(to)).toBeLessThan(24_500);
  });

  it("lets a train ride the path to the terminus within a metre of the rails", () => {
    const points = railRide(pathToTerminus(), { intervalS: 5 });
    expect(points.length).toBeGreaterThan(100);
    const rails = [trackA, branchLine, terminusTracks[0] ?? []];
    for (const point of points) {
      expect(Math.min(...rails.map((line) => distanceToLine(toXY(point), line)))).toBeLessThan(1);
    }
    expect(points[1]?.t).toBe((points[0]?.t ?? 0) + 5);
  });

  it("writes its ways as OPL lines the importer reads back, and a polygon it parses", () => {
    const { ways } = railWorld();
    for (const [position, line] of oplLinesOf({ ways, pois: [] }).entries()) {
      const parsed = parseOplWay(line);
      const way = ways[position];
      if (!parsed.ok || way === undefined) throw new Error(`unreadable line ${line}`);
      expect(parsed.way.id).toBe(way.id);
      expect(parsed.way.nodes).toEqual(way.nodes);
      expect(parsed.way.tags["service"]).toBe(way.service);
      expect(parsed.way.tags[way.kind === "rail" ? "railway" : "highway"]).toBeDefined();
    }
    const outline = parseRegionPoly(
      regionPolyText("rail-world", [
        [3.5, 50.9],
        [3.9, 50.9],
        [3.9, 51.1],
        [3.5, 51.1],
      ]),
    );
    expect(outline.polygon.coordinates[0]?.[0]).toHaveLength(5);
    expect(outline.minLon).toBeCloseTo(3.5, 6);
  });
});
