import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latToTileY, lonToTileX, tileBounds } from "../../src/heatmap/tileMath";
import { parseRegionPoly } from "../../src/mapdata/regionPoly";
import { type CoveragePolygon, regionCoverage } from "../../src/processing/regionCoverage";
import { monacoDir } from "../support/mapDataFixture";

type Ring = [number, number][];
const polygon = (...rings: Ring[]): CoveragePolygon => ({ coordinates: [rings] });
/** A closed rectangle `[west, south, east, north]` as a ring. */
const rectangle = (west: number, south: number, east: number, north: number): Ring => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

const tile = { z: 14, x: 8400, y: 5500 };
const key = `${tile.z}/${tile.x}/${tile.y}`;
const [south, west, north, east] = tileBounds(tile.x, tile.y, tile.z);
const margin = 0.0005;

describe("regionCoverage", () => {
  it("covers a tile whose four corners lie inside", () => {
    const coverage = regionCoverage([
      polygon(rectangle(west - margin, south - margin, east + margin, north + margin)),
    ]);
    expect(coverage.covers(key)).toBe(true);
    expect(coverage.covers(`14/${tile.x + 3}/${tile.y}`)).toBe(false);
  });

  it("does not cover a tile with three corners inside", () => {
    const midLon = (west + east) / 2;
    const midLat = (south + north) / 2;
    // The rectangle with its north-east corner cut off.
    const cut: Ring = [
      [west - margin, south - margin],
      [east + margin, south - margin],
      [east + margin, midLat],
      [midLon, north + margin],
      [west - margin, north + margin],
      [west - margin, south - margin],
    ];
    expect(regionCoverage([polygon(cut)]).covers(key)).toBe(false);
  });

  it("is uncovered by a hole over one corner", () => {
    const outline = rectangle(west - margin, south - margin, east + margin, north + margin);
    const hole = rectangle(east - margin, north - margin, east + 2 * margin, north + 2 * margin);
    expect(regionCoverage([polygon(outline, hole)]).covers(key)).toBe(false);
    expect(regionCoverage([polygon(outline)]).covers(key)).toBe(true);
  });

  it("covers by the union: a tile on the border of two regions that neither covers alone", () => {
    const midLon = (west + east) / 2;
    const left = polygon(rectangle(west - 0.01, south - 0.01, midLon + 0.001, north + 0.01));
    const right = polygon(rectangle(midLon - 0.001, south - 0.01, east + 0.01, north + 0.01));
    expect(regionCoverage([left]).covers(key)).toBe(false);
    expect(regionCoverage([right]).covers(key)).toBe(false);
    expect(regionCoverage([left, right]).covers(key)).toBe(true);
    expect(regionCoverage([right, left]).covers(key)).toBe(true);
  });

  it("covers nothing without polygons, and no malformed key", () => {
    expect(regionCoverage([]).covers(key)).toBe(false);
    const everything = regionCoverage([polygon(rectangle(-180, -85, 180, 85))]);
    expect(everything.covers("not a tile")).toBe(false);
    expect(everything.covers(key)).toBe(true);
  });

  it("answers the same when asked again, and for a set of keys", () => {
    const coverage = regionCoverage([
      polygon(rectangle(west - margin, south - margin, east + margin, north + margin)),
    ]);
    const keys = [key, `14/${tile.x + 1}/${tile.y}`, key];
    const first = coverage.covered(keys);
    expect([...first]).toEqual([key]);
    expect([...coverage.covered(keys)]).toEqual([...first]);
    expect(coverage.covers(key)).toBe(true);
  });

  it("covers exactly the one of Monaco's six street tiles that the design measured", () => {
    const outline = parseRegionPoly(readFileSync(`${monacoDir}/region.poly`, "utf8"));
    const coverage = regionCoverage([outline.polygon]);
    const streetTiles = [
      "14/8528/5975",
      "14/8529/5973",
      "14/8529/5974",
      "14/8529/5975",
      "14/8530/5973",
      "14/8530/5974",
    ];
    expect([...coverage.covered(streetTiles)]).toEqual(["14/8530/5974"]);
  });

  it("covers the tiles of a polygon that follows a coast, 36 in all for Monaco's", () => {
    const outline = parseRegionPoly(readFileSync(`${monacoDir}/region.poly`, "utf8"));
    const coverage = regionCoverage([outline.polygon]);
    const keys: string[] = [];
    for (let x = lonToTileX(outline.minLon, 14); x <= lonToTileX(outline.maxLon, 14); x += 1) {
      for (let y = latToTileY(outline.maxLat, 14); y <= latToTileY(outline.minLat, 14); y += 1) {
        keys.push(`14/${x}/${y}`);
      }
    }
    expect(coverage.covered(keys).size).toBe(36);
  });

  it("costs a few milliseconds for a commuter's tiles with a polygon of Belgium's size", () => {
    // 8 000 vertices of a wobbling circle of 1.5 degrees around Brussels, one outline.
    const outline: Ring = [];
    for (let index = 0; index < 8000; index += 1) {
      const angle = (2 * Math.PI * index) / 8000;
      const radius = 1.5 + 0.1 * Math.sin(37 * angle);
      outline.push([4.35 + radius * Math.cos(angle) * 1.6, 50.85 + radius * Math.sin(angle)]);
    }
    outline.push(outline[0] ?? [0, 0]);
    const keys: string[] = [];
    for (let x = 8392; x < 8400; x += 1) {
      for (let y = 5500; y < 5508; y += 1) keys.push(`14/${x}/${y}`);
    }
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = performance.now();
      const coverage = regionCoverage([polygon(outline)]);
      const covered = coverage.covered(keys.slice(0, 60));
      best = Math.min(best, performance.now() - started);
      expect(covered.size).toBe(60);
    }
    expect(best).toBeLessThan(5);
  });
});
