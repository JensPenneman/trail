import { describe, expect, it } from "vitest";
import { groupWays, type NamedWay } from "../../src/insights/groupWays";
import type { MoveWays } from "../../src/insights/loadMoveWays";
import { periodWayTotals } from "../../src/insights/loadWays";
import { localHours } from "../../src/insights/localHours";

const way = (name: string, metres: number, lat: number, lon: number): NamedWay => ({
  name,
  kind: "residential",
  metres,
  lat,
  lon,
});

describe("groupWays", () => {
  it("joins the ways of one name in the same or touching cells, and keeps towns apart", () => {
    const groups = groupWays([
      way("Stationstraat", 400, 51.0, 3.7),
      // A few hundred metres on: same cell, then the next cell east (diagonal touching too).
      way("Stationstraat", 300, 51.001, 3.701),
      way("Stationstraat", 200, 51.0, 3.75),
      // Another town, far from the first.
      way("Stationstraat", 900, 50.63, 5.57),
      way("Dorpsstraat", 100, 51.0, 3.7),
    ]);
    expect(groups.map((group) => [group.name, group.metres, group.ways])).toEqual([
      ["Stationstraat", 900, 1],
      ["Stationstraat", 900, 3],
      ["Dorpsstraat", 100, 1],
    ]);
    expect(groups[0]?.lat).toBeCloseTo(50.63, 5);
  });

  it("puts the centre where the metres are, and the kind of the longest way", () => {
    const [group] = groupWays([
      { ...way("Ring", 300, 51.0, 3.7), kind: "motorway" },
      way("Ring", 100, 51.002, 3.704),
    ]);
    expect(group?.kind).toBe("motorway");
    expect(group?.lat).toBeCloseTo(51.0005, 6);
    expect(group?.lon).toBeCloseTo(3.701, 6);
  });

  it("orders equal lengths by name", () => {
    const groups = groupWays([way("B", 10, 51, 3.7), way("A", 10, 51, 3.7)]);
    expect(groups.map((group) => group.name)).toEqual(["A", "B"]);
  });
});

describe("periodWayTotals", () => {
  const hours = localHours("2026-10-20", "2026-10-20", "UTC");
  const start = Date.parse("2026-10-20T00:00:00Z");
  const move = (
    mode: MoveWays["mode"],
    startH: number,
    endH: number,
    totals: [number, number][],
  ) => ({
    mode,
    startMs: start + startH * 3_600_000,
    endMs: start + endH * 3_600_000,
    distanceM: 1000,
    wayTotals: totals,
  });

  it("counts a move in proportion to its time inside the period", () => {
    // 22:00 to 02:00 next day: half of it inside.
    const { distanceM, ways } = periodWayTotals([move("cycling", 22, 26, [[1, 800]])], hours, null);
    expect(distanceM).toBeCloseTo(500, 6);
    expect(ways.get(1)).toBeCloseTo(400, 6);
  });

  it("takes one mode when asked, and moves without totals count towards the distance only", () => {
    const moves = [
      move("walking", 8, 9, [[1, 300]]),
      move("cycling", 10, 11, [[2, 500]]),
      move("car", 12, 13, []),
    ];
    const walking = periodWayTotals(moves, hours, "walking");
    expect([walking.distanceM, [...walking.ways]]).toEqual([1000, [[1, 300]]]);
    const all = periodWayTotals(moves, hours, null);
    expect([all.distanceM, all.ways.size]).toEqual([3000, 2]);
  });
});
