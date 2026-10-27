import { describe, expect, it } from "vitest";
import { chooseCellZoom } from "../../src/heatmap/chooseCellZoom";
import { recordedHeatLevels } from "../../src/heatmap/fillHeatLevels";
import { heatCellWindow } from "../../src/heatmap/heatCellWindow";
import { storedCellZoom } from "../../src/heatmap/storedCellZoom";
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
  it("is five levels finer than the rounded map zoom: cells about 16 px wide", () => {
    expect(chooseCellZoom(4)).toBe(9);
    expect(chooseCellZoom(6)).toBe(11);
    expect(chooseCellZoom(7.4)).toBe(12);
    expect(chooseCellZoom(7.5)).toBe(13);
    expect(chooseCellZoom(10)).toBe(15);
    expect(chooseCellZoom(12)).toBe(17);
  });

  it("stays within the levels the heatmap answers at", () => {
    expect(chooseCellZoom(0)).toBe(6);
    expect(chooseCellZoom(1)).toBe(6);
    expect(chooseCellZoom(13)).toBe(18);
    expect(chooseCellZoom(14)).toBe(19);
    expect(chooseCellZoom(15)).toBe(20);
    expect(chooseCellZoom(16)).toBe(20);
    expect(chooseCellZoom(24)).toBe(20);
  });
});

describe("storedCellZoom", () => {
  it("reads the coarsest stored level at least as fine", () => {
    expect([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(storedCellZoom)).toEqual([
      6, 9, 9, 9, 12, 12, 12, 15, 15, 15, 18, 18, 18, 20, 20,
    ]);
  });

  it("has nothing finer than the finest stored level", () => {
    expect(() => storedCellZoom(21)).toThrow(RangeError);
  });
});

describe("recordedHeatLevels", () => {
  it("reads the levels recorded in processing_state", () => {
    expect(recordedHeatLevels({ levels: [6, 9, 12, 15, 18, 20] })).toEqual([6, 9, 12, 15, 18, 20]);
  });

  it("takes an install that recorded nothing for one with the five levels of old", () => {
    expect(recordedHeatLevels(null)).toEqual([6, 9, 12, 15, 18]);
    expect(recordedHeatLevels({ levels: ["20"] })).toEqual([6, 9, 12, 15, 18]);
    expect(recordedHeatLevels("levels")).toEqual([6, 9, 12, 15, 18]);
  });
});

describe("heatCellWindow", () => {
  it("reads a stored level directly when it is the one asked for", () => {
    // Ghent's centre, a little around it, at z12 (stored).
    expect(heatCellWindow([3.7, 51.04, 3.73, 51.06], 12)).toEqual({
      stored: 12,
      shift: 0,
      rows: [latToTileY(51.06, 12), latToTileY(51.04, 12)],
      columns: [lonToTileX(3.7, 12), lonToTileX(3.73, 12)],
      wraps: false,
    });
  });

  it("covers whole cells of the level asked for in the finer stored level", () => {
    const bbox = [3.7, 51.04, 3.73, 51.06] as const;
    const area = heatCellWindow(bbox, 13);
    expect(area).toMatchObject({ stored: 15, shift: 2, wraps: false });
    // The first stored row and column start a z13 cell; the last ones end one.
    expect(area.rows[0]).toBe(latToTileY(51.06, 13) * 4);
    expect(area.rows[1]).toBe(latToTileY(51.04, 13) * 4 + 3);
    expect(area.columns[0]).toBe(lonToTileX(3.7, 13) * 4);
    expect(area.columns[1]).toBe(lonToTileX(3.73, 13) * 4 + 3);
    // So it reaches past the viewport, as far as the cells at its edges do.
    expect(area.columns[0]).toBeLessThanOrEqual(lonToTileX(3.7, 15));
    expect(area.columns[1]).toBeGreaterThanOrEqual(lonToTileX(3.73, 15));
  });

  it("sums level 19 from level 20, the finest stored", () => {
    const area = heatCellWindow([3.7, 51.04, 3.73, 51.06], 19);
    expect(area).toMatchObject({ stored: 20, shift: 1, wraps: false });
    expect(area.columns).toEqual([lonToTileX(3.7, 19) * 2, lonToTileX(3.73, 19) * 2 + 1]);
  });

  it("keeps the antimeridian's two column ranges", () => {
    const area = heatCellWindow([170, -10, -170, 10], 8);
    expect(area).toMatchObject({ stored: 9, shift: 1, wraps: true });
    expect(area.columns).toEqual([lonToTileX(170, 8) * 2, lonToTileX(-170, 8) * 2 + 1]);
  });
});
