import { describe, expect, it } from "vitest";
import { heatFeatures } from "../src/map/heatFeatures";
import { heatRamp } from "../src/map/heatRamp";
import { heatClassOf, heatScale, heatShadeOf } from "../src/map/heatScale";

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

describe("heatFeatures", () => {
  const tiles = 2 ** 12;
  const lonOf = (column: number) => (column / tiles) * 360 - 180;
  const latOf = (row: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / tiles))) * 180) / Math.PI;
  // The centre of tile (2090, 1370) at z12: Ghent.
  const centre = [lonOf(2090.5), latOf(1370.5)] as const;
  const heat = (count: number) => ({
    cells: [[centre[0], centre[1], count] as const],
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

  it("keeps the gap thin on cells wider on screen, and the squares visible on small ones", () => {
    // Four zooms on, the tile is 256 px wide.
    expect(ring(11)[0]?.[0]).toBeCloseTo(lonOf(2090 + 1.5 / 256 / 2), 9);
    // Far zoomed out the gap stays a fifth of the cell at most.
    expect(ring(2)[0]?.[0]).toBeCloseTo(lonOf(2090 + 0.1), 9);
  });

  it("gives each square the ramp step of its class", () => {
    const shades = [3, 50, 5_000].map(
      (count) => heatFeatures(heat(count), 7).features[0]?.properties.shade,
    );
    expect(shades).toEqual([1, 4, 6]);
  });
});
