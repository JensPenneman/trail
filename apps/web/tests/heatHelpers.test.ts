import { describe, expect, it } from "vitest";
import { heatFeatures } from "../src/map/heatFeatures";
import { heatRamp } from "../src/map/heatRamp";
import {
  countLadders,
  durationLadders,
  heatClassOf,
  heatScale,
  heatShadeOf,
} from "../src/map/heatScale";
import { cellCentre, cellEdges } from "../src/map/heatTiles";

/** `count` cells of every value, for a distribution of a given shape. */
const spread = (...groups: (readonly [value: number, cells: number])[]) =>
  groups.flatMap(([value, cells]) => Array.from({ length: cells }, () => value));

describe("heatScale", () => {
  it("has no classes for an empty view", () => {
    expect(heatScale([])).toEqual({ starts: [] });
    expect(heatScale([0, Number.NaN])).toEqual({ starts: [] });
  });

  it("has one class when every cell holds as many points", () => {
    expect(heatScale([7, 7, 7])).toEqual({ starts: [7] });
  });

  it("steps by 1, 2 and 5 over a short range", () => {
    expect(heatScale([1, 3, 7, 12, 25, 40]).starts).toEqual([1, 2, 5, 10, 20]);
  });

  it("steps by half decades over a longer one, the busiest few per cent sharing the top class", () => {
    // Most cells up to 300 points; home and work far above them.
    const counts = spread([1, 30], [4, 20], [20, 20], [60, 15], [150, 7], [300, 5], [800_000, 3]);
    expect(heatScale(counts).starts).toEqual([1, 3, 10, 30, 100, 300]);
  });

  it("keeps the highest half decades rather than dropping to whole ones", () => {
    const counts = spread([1, 40], [50, 30], [400, 20], [3_000, 7], [900_000, 3]);
    expect(heatScale(counts).starts).toEqual([1, 30, 100, 300, 1_000, 3_000]);
  });

  it("steps by decades over a range too long for half decades", () => {
    const counts = spread([1, 40], [500, 30], [50_000, 30]);
    expect(heatScale(counts).starts).toEqual([1, 10, 100, 1_000, 10_000]);
  });

  it("starts at the smallest count in view", () => {
    // Zoomed out, every cell holds many points.
    const counts = spread([157, 2], [600, 6], [2_000, 4], [5_000, 2], [20_000, 1], [93_544, 5]);
    expect(heatScale(counts).starts).toEqual([157, 300, 1_000, 3_000, 10_000, 30_000]);
  });

  it("keeps the busiest of a small view apart from the rest", () => {
    // Fewer than 34 cells: the top class is the busiest cell's alone.
    const two = heatScale([1, 1_000_000]);
    expect(two.starts).toEqual([1, 100, 10_000, 1_000_000]);
    expect([1, 1_000_000].map((count) => heatShadeOf(heatClassOf(two, count), 4))).toEqual([1, 6]);
    const three = heatScale([3, 3, 900]);
    expect(three.starts).toEqual([3, 10, 30, 100, 300]);
    expect(heatClassOf(three, 900)).toBe(4);
  });

  it("keeps its round numbers while the counts in view change a little", () => {
    const before = spread([1, 30], [40, 30], [310, 10]);
    const after = spread([2, 25], [35, 33], [450, 12]);
    expect(heatScale(after).starts.slice(1)).toEqual(heatScale(before).starts.slice(1));
  });

  it("puts a count in the class whose range holds it", () => {
    const scale = { starts: [1, 3, 10, 30, 100, 300] };
    expect([1, 2, 3, 9, 10, 299, 300, 900_000].map((count) => heatClassOf(scale, count))).toEqual([
      0, 0, 1, 1, 2, 4, 5, 5,
    ]);
  });

  it("spreads fewer classes over the whole ramp", () => {
    expect([0, 1, 2, 3, 4, 5].map((index) => heatShadeOf(index, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    expect([0, 1, 2].map((index) => heatShadeOf(index, 3))).toEqual([1, 4, 6]);
    expect([0, 1].map((index) => heatShadeOf(index, 2))).toEqual([1, 6]);
    expect(heatShadeOf(0, 1)).toBe(4);
  });

  it("has a ramp step for every shade, light and dark", () => {
    expect(heatRamp.light).toHaveLength(6);
    expect(heatRamp.dark).toHaveLength(6);
  });
});

describe("heatScale by time spent", () => {
  const minute = 60;
  const hour = 3600;
  const day = 86_400;
  const scale = (...values: number[]) => heatScale(values, durationLadders).starts;

  it("steps by round times, the finest series that fits six classes", () => {
    // The finest series would need seven classes here; the next one fits five.
    expect(scale(2 * minute, 7 * minute, 40 * minute, 90 * minute, 3 * hour)).toEqual([
      2 * minute,
      5 * minute,
      15 * minute,
      hour,
      3 * hour,
    ]);
    // A short range keeps the finest series.
    expect(scale(2 * minute, 4 * minute, 12 * minute)).toEqual([
      2 * minute,
      5 * minute,
      10 * minute,
    ]);
  });

  it("gives way to coarser series over longer ranges, down to one that always fits", () => {
    const wide = scale(minute, 20 * minute, 5 * hour, 2 * day, 30 * day);
    expect(wide.length).toBeLessThanOrEqual(6);
    expect(wide[0]).toBe(minute);
    // Every start is a round time of some series.
    const round = new Set(durationLadders.flatMap((ladder) => ladder.startsUpTo(40 * day)));
    for (const start of wide) expect(round.has(start)).toBe(true);
    expect(scale(30, 40 * 7 * day)).toEqual(
      [30, minute, hour, day, 7 * day].filter((v) => v <= 40 * 7 * day),
    );
  });

  it("keeps the busiest few per cent in the top class and counts as before", () => {
    expect(heatScale([1, 3, 7, 12, 25, 40], countLadders).starts).toEqual([1, 2, 5, 10, 20]);
    expect(heatScale([1, 3, 7, 12, 25, 40]).starts).toEqual([1, 2, 5, 10, 20]);
  });
});

describe("heat tiles", () => {
  const tiles = 2 ** 12;
  const lonOf = (column: number) => (column / tiles) * 360 - 180;
  const latOf = (row: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / tiles))) * 180) / Math.PI;

  it("gives the edges and the centre of a tile, with an inset", () => {
    const edges = cellEdges(2090, 1370, 12);
    expect(edges.west).toBeCloseTo(lonOf(2090), 9);
    expect(edges.east).toBeCloseTo(lonOf(2091), 9);
    expect(edges.north).toBeCloseTo(latOf(1370), 9);
    expect(edges.south).toBeCloseTo(latOf(1371), 9);
    const [lon, lat] = cellCentre(2090, 1370, 12);
    expect(lon).toBeCloseTo(lonOf(2090.5), 9);
    expect(lat).toBeCloseTo(latOf(1370.5), 9);
    expect(cellEdges(2090, 1370, 12, 0.25).west).toBeCloseTo(lonOf(2090.25), 9);
  });

  it("keeps the first and last columns of the world apart", () => {
    expect(cellEdges(0, 0, 6).west).toBeCloseTo(-180, 9);
    expect(cellEdges(63, 0, 6).east).toBeCloseTo(180, 9);
  });
});

describe("heatFeatures", () => {
  const tiles = 2 ** 12;
  const lonOf = (column: number) => (column / tiles) * 360 - 180;
  const latOf = (row: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / tiles))) * 180) / Math.PI;
  // Tile (2090, 1370) at z12: Ghent.
  const heat = (count: number) => ({
    cells: [[2090, 1370, count] as const],
    cellZoom: 12,
    scale: { starts: [1, 10, 100] },
  });
  const ring = (zoom: number) =>
    heatFeatures(heat(50), zoom).features[0]?.geometry.coordinates[0] ?? [];
  it("draws nothing without cells", () => {
    expect(heatFeatures(null, 7).features).toEqual([]);
  });

  it("draws a cell as its tile, a gap of 1.5 px smaller", () => {
    // At zoom 7 a z12 tile is 16 px wide: 1.5 px is 0.09375 of it, half on each side.
    const [northWest, northEast, southEast, southWest, closing] = ring(7);
    expect(northWest?.[0]).toBeCloseTo(lonOf(2090 + 0.046875), 9);
    expect(northWest?.[1]).toBeCloseTo(latOf(1370 + 0.046875), 9);
    expect(northEast?.[0]).toBeCloseTo(lonOf(2091 - 0.046875), 9);
    expect(southEast?.[1]).toBeCloseTo(latOf(1371 - 0.046875), 9);
    expect(southWest?.[0]).toBeCloseTo(lonOf(2090 + 0.046875), 9);
    expect(closing).toEqual(northWest);
  });

  it("draws the square at most 20 px wide, centred, on cells wider on screen", () => {
    // Three zooms on the tile is 128 px wide: a 20 px square in its middle.
    const [northWest, northEast] = ring(10);
    expect(northWest?.[0]).toBeCloseTo(lonOf(2090 + (1 - 20 / 128) / 2), 9);
    expect(northEast?.[0]).toBeCloseTo(lonOf(2091 - (1 - 20 / 128) / 2), 9);
    // Just under 20 px wide, the gap is still the thin one.
    expect(ring(7.25)[0]?.[0]).toBeCloseTo(lonOf(2090 + 1.5 / (16 * 2 ** 0.25) / 2), 9);
  });

  it("keeps the squares visible on cells far smaller than meant", () => {
    // Far zoomed out the gap stays a fifth of the cell at most.
    expect(ring(2)[0]?.[0]).toBeCloseTo(lonOf(2090 + 0.1), 9);
  });

  it("draws cells on both sides of the antimeridian from their tiles", () => {
    const world = {
      cells: [[0, 1370, 5] as const, [tiles - 1, 1370, 5] as const],
      cellZoom: 12,
      scale: { starts: [1] },
    };
    const [west, east] = heatFeatures(world, 7).features.map(
      (feature) => feature.geometry.coordinates[0]?.[0]?.[0] ?? 0,
    );
    expect(west).toBeCloseTo(-180, 0);
    expect(east).toBeCloseTo(180, 0);
  });

  it("gives each square the ramp step of its class", () => {
    const shades = [3, 50, 5_000].map(
      (count) => heatFeatures(heat(count), 7).features[0]?.properties.shade,
    );
    expect(shades).toEqual([1, 4, 6]);
  });
});
