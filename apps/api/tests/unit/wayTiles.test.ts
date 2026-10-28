import { describe, expect, it } from "vitest";
import { latToTileY, lonToTileX, tileBounds } from "../../src/heatmap/tileMath";
import { emptyWayCounts, wayRows } from "../../src/mapdata/wayRows";
import { maxTilesPerWay, tileOfNumber, wayTiles } from "../../src/mapdata/wayTiles";
import { tileKey } from "../../src/processing/tileCover";
import { fixtureLines } from "../support/mapDataFixture";

const keys = (tiles: Set<number> | null) =>
  [...(tiles ?? [])].map((tile) => tileKey(14, ...tileOfNumber(tile))).sort();

/** A position inside tile (x, y) of z14, at a fraction of its width and height. */
function inTile(x: number, y: number, fx: number, fy: number): [number, number] {
  const [south, west, north, east] = tileBounds(x, y, 14);
  return [west + fx * (east - west), north - fy * (north - south)];
}

const e7 = (positions: readonly [number, number][]) =>
  Int32Array.from(
    positions.flatMap(([lon, lat]) => [Math.round(lon * 1e7), Math.round(lat * 1e7)]),
  );

describe("wayTiles", () => {
  it("gives the tiles a way's segments pass through, in tileMath's numbering", () => {
    // Three tiles east and one south: the segment crosses into row 5001 (at 47 % of its length)
    // before column 8002 (at 50 %), so five tiles, not the eight of its bounding box.
    const tiles = wayTiles(e7([inTile(8000, 5000, 0.2, 0.2), inTile(8003, 5001, 0.8, 0.9)]));
    expect(keys(tiles)).toEqual(
      ["14/8000/5000", "14/8001/5000", "14/8001/5001", "14/8002/5001", "14/8003/5001"].sort(),
    );
    // A way inside one tile is in that tile only.
    expect(
      keys(wayTiles(e7([inTile(8000, 5000, 0.1, 0.1), inTile(8000, 5000, 0.9, 0.8)]))),
    ).toEqual(["14/8000/5000"]);
  });

  it("puts every vertex of the fixture's ways in its own tile, and no tile beyond a segment's box", () => {
    for (const way of wayRows(fixtureLines("ways.opl.gz"), emptyWayCounts())) {
      const geometry: [number, number][] = [];
      const view = new DataView(
        way.geometry.buffer,
        way.geometry.byteOffset,
        way.geometry.byteLength,
      );
      for (let offset = 0; offset < way.geometry.byteLength; offset += 8) {
        geometry.push([view.getInt32(offset) / 1e7, view.getInt32(offset + 4) / 1e7]);
      }
      const tiles = new Set(keys(way.tiles));
      const inBoxes = new Set<string>();
      for (const [index, [lon, lat]] of geometry.entries()) {
        expect(tiles.has(tileKey(14, lonToTileX(lon, 14), latToTileY(lat, 14)))).toBe(true);
        const [nextLon, nextLat] = geometry[index + 1] ?? [lon, lat];
        for (
          let x = lonToTileX(Math.min(lon, nextLon), 14);
          x <= lonToTileX(Math.max(lon, nextLon), 14);
          x += 1
        ) {
          for (
            let y = latToTileY(Math.max(lat, nextLat), 14);
            y <= latToTileY(Math.min(lat, nextLat), 14);
            y += 1
          ) {
            inBoxes.add(tileKey(14, x, y));
          }
        }
      }
      for (const tile of tiles) expect(inBoxes.has(tile)).toBe(true);
    }
  });

  it("finds the six tiles of Monaco's streets", () => {
    const all = new Set<string>();
    for (const way of wayRows(fixtureLines("ways.opl.gz"), emptyWayCounts())) {
      for (const tile of keys(way.tiles)) all.add(tile);
    }
    expect([...all].sort()).toEqual(
      [
        "14/8528/5975",
        "14/8529/5973",
        "14/8529/5974",
        "14/8529/5975",
        "14/8530/5973",
        "14/8530/5974",
      ].sort(),
    );
  });

  it("refuses a way across too many tiles, and one across the antimeridian", () => {
    // From Brussels to Athens: about 1 800 km, some 2 600 tiles, is still a way.
    expect(
      wayTiles(
        e7([
          [4.35, 50.85],
          [23.7, 37.98],
        ]),
      )?.size,
    ).toBeGreaterThan(1000);
    expect(
      wayTiles(
        e7([
          [-179.9, 0],
          [179.9, 0],
        ]),
      ),
    ).toBeNull();
    const zigzag: [number, number][] = [];
    for (let vertex = 0; vertex < 200; vertex += 1)
      zigzag.push([vertex % 2 === 0 ? 0 : 20, vertex * 0.001]);
    expect(wayTiles(e7(zigzag))).toBeNull();
    expect(maxTilesPerWay).toBe(10_000);
  });

  it("keeps positions beyond Web Mercator's latitudes in the edge tiles", () => {
    expect(
      keys(
        wayTiles(
          e7([
            [0, 89],
            [0, 88.9],
          ]),
        ),
      ),
    ).toEqual(["14/8192/0"]);
    expect(
      keys(
        wayTiles(
          e7([
            [180, 0.001],
            [179.99999, 0.002],
          ]),
        ),
      ),
    ).toEqual(["14/16383/8191"]);
  });
});
