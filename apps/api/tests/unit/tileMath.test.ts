import { describe, expect, it } from "vitest";
import { chooseCellZoom } from "../../src/heatmap/chooseCellZoom";
import { latToTileY, lonToTileX, tileCentre } from "../../src/heatmap/tileMath";

describe("tile maths", () => {
  it("matches the slippy-map scheme", () => {
    // The null meridian and the equator meet at the corner of the four z1 tiles.
    expect(lonToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBe(1);
    expect(lonToTileX(-0.0001, 1)).toBe(0);
    expect(latToTileY(0.0001, 1)).toBe(0);
    // Ghent's centre at z12.
    expect(lonToTileX(3.7174, 12)).toBe(2090);
    expect(latToTileY(51.0543, 12)).toBe(1370);
  });

  it("clamps at the edges of the world", () => {
    expect(lonToTileX(-180, 6)).toBe(0);
    expect(lonToTileX(180, 6)).toBe(63);
    expect(latToTileY(89.9, 6)).toBe(0);
    expect(latToTileY(-89.9, 6)).toBe(63);
  });

  it("returns cell centres inside their cell", () => {
    const [lon, lat] = tileCentre(2090, 1366, 12);
    expect(lonToTileX(lon, 12)).toBe(2090);
    expect(latToTileY(lat, 12)).toBe(1366);
  });
});

describe("chooseCellZoom", () => {
  it("picks the largest stored level ≤ round(zoom) + 5, at least 6", () => {
    expect(chooseCellZoom(0)).toBe(6);
    expect(chooseCellZoom(1)).toBe(6);
    expect(chooseCellZoom(4)).toBe(9);
    expect(chooseCellZoom(7.4)).toBe(12);
    expect(chooseCellZoom(7.5)).toBe(12);
    expect(chooseCellZoom(10)).toBe(15);
    expect(chooseCellZoom(13)).toBe(18);
    expect(chooseCellZoom(24)).toBe(18);
  });
});
