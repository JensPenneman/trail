import { describe, expect, it } from "vitest";
import { groupWays, type NamedWay } from "../../src/insights/groupWays";
import type { MoveWays } from "../../src/insights/loadMoveWays";
import { periodWayTotals } from "../../src/insights/loadWays";
import { localHours } from "../../src/insights/localHours";

const way = (
  name: string,
  metres: number,
  lat: number,
  lon: number,
  moves: number[] = [0],
): NamedWay => ({ name, kind: "residential", metres, lat, lon, moves });

describe("groupWays", () => {
  it("joins the ways of one name in the same or touching cells, and keeps far villages apart", () => {
    const groups = groupWays([
      way("Stationstraat", 400, 51.0, 3.7, [0, 1]),
      // A few hundred metres on: the same cell of about 10 km.
      way("Stationstraat", 300, 51.001, 3.701, [1, 2]),
      // 5 km east: the next cell, touching.
      way("Stationstraat", 200, 51.0, 3.78, [3]),
      // 30 km east of the first: cells away, a road of its own.
      way("Stationstraat", 100, 51.0, 4.1, [4]),
      // Another town, far away.
      way("Stationstraat", 950, 50.63, 5.57, [5]),
      way("Dorpsstraat", 50, 51.0, 3.7, [0]),
    ]);
    expect(groups.map((group) => [group.name, group.metres, group.moves])).toEqual([
      ["Stationstraat", 950, 1],
      ["Stationstraat", 900, 4],
      ["Stationstraat", 100, 1],
      ["Dorpsstraat", 50, 1],
    ]);
    expect(groups[0]?.lat).toBeCloseTo(50.63, 5);
  });

  it("counts a move once however many ways of a road it was on", () => {
    const [group] = groupWays([
      way("Ring", 300, 51.0, 3.7, [7, 8]),
      way("Ring", 100, 51.0, 3.701, [8, 9]),
    ]);
    expect(group?.moves).toBe(3);
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
    totals: [number, number][] | null,
    lacking = false,
  ): MoveWays => ({
    mode,
    startMs: start + startH * 3_600_000,
    endMs: start + endH * 3_600_000,
    distanceM: 1000,
    wayTotals: totals,
    lacking,
  });

  it("counts a move in proportion to its time inside the period", () => {
    // 22:00 to 02:00 next day: half of it inside.
    const { mappedM, ways } = periodWayTotals([move("cycling", 22, 26, [[1, 800]])], hours, null);
    expect(mappedM).toBeCloseTo(500, 6);
    expect(ways.get(1)?.metres).toBeCloseTo(400, 6);
    expect(ways.get(1)?.moves).toEqual([0]);
  });

  it("takes one mode when asked; moves without totals count towards nothing, a waiting one is lacking", () => {
    const moves = [
      move("walking", 8, 9, [[1, 300]]),
      move("cycling", 10, 11, [[2, 500]]),
      move("car", 12, 13, null),
      move("car", 14, 15, null, true),
    ];
    const walking = periodWayTotals(moves, hours, "walking");
    expect([walking.mappedM, walking.lacking, [...walking.ways.keys()]]).toEqual([
      1000,
      false,
      [1],
    ]);
    const car = periodWayTotals(moves, hours, "car");
    expect([car.mappedM, car.lacking]).toEqual([0, true]);
    const all = periodWayTotals(moves, hours, null);
    expect([all.mappedM, all.ways.size]).toEqual([2000, 2]);
  });
});
