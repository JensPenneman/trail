import { describe, expect, it } from "vitest";
import { latToTileY, lonToTileX, tileBounds } from "../../src/heatmap/tileMath";
import { averagePoints } from "../../src/processing/averagePoints";
import { backfillLevel } from "../../src/processing/backfill";
import { keptPoints } from "../../src/processing/keptPoint";
import { motionActivity } from "../../src/processing/motionActivity";
import {
  defaultProcessingConfig,
  processingConfigWith,
} from "../../src/processing/processingConfig";
import { processingVersions } from "../../src/processing/processingVersion";
import { moveTiles, parseTileKey, tileKey } from "../../src/processing/tileCover";
import { weightedQuantile } from "../../src/processing/weightedQuantile";
import { decodeTimelineCursor, encodeTimelineCursor } from "../../src/transport/timelineCursor";
import { motorwayDrive, sparseTrain } from "../support/journeys";

const kept = (points: Parameters<typeof averagePoints>[0]) =>
  keptPoints(points, averagePoints(points, defaultProcessingConfig.averaging));

describe("weightedQuantile", () => {
  it("weighs the values and breaks ties by input order", () => {
    expect(weightedQuantile([10, 20, 30], [1, 1, 1], 0.5)).toBe(20);
    expect(weightedQuantile([10, 20, 30], [1, 1, 10], 0.5)).toBe(30);
    expect(weightedQuantile([30, 10, 20], [1, 1, 1], 0.85)).toBe(30);
    expect(weightedQuantile([], [], 0.5)).toBeNaN();
  });
});

describe("motionActivity", () => {
  it("prefers a moving activity over stationary and knows driving as automotive", () => {
    expect(motionActivity(["stationary", "driving"])).toBe("automotive");
    expect(motionActivity(["stationary"])).toBe("stationary");
    expect(motionActivity(["walking"])).toBe("walking");
    expect(motionActivity([])).toBeNull();
    expect(motionActivity(["unknown"])).toBeNull();
    // A phone's words are values, never the names of an object's own methods.
    expect(motionActivity(["constructor", "toString"])).toBeNull();
    expect(motionActivity(["__proto__", "walking"])).toBe("walking");
  });
});

describe("tiles", () => {
  it("writes and reads tile keys", () => {
    expect(tileKey(14, 8360, 5482)).toBe("14/8360/5482");
    expect(parseTileKey("14/8360/5482")).toEqual({ z: 14, x: 8360, y: 5482 });
    expect(parseTileKey("14/8360")).toBeNull();
    expect(parseTileKey("../etc")).toBeNull();
  });

  it("gives tile bounds south, west, north, east around their points", () => {
    const x = lonToTileX(3.7, 14);
    const y = latToTileY(51.05, 14);
    const [south, west, north, east] = tileBounds(x, y, 14);
    expect(south).toBeLessThan(51.05);
    expect(north).toBeGreaterThan(51.05);
    expect(west).toBeLessThan(3.7);
    expect(east).toBeGreaterThan(3.7);
  });

  it("covers a dense move's points and a sparse move's corridor", () => {
    const dense = moveTiles(kept(motorwayDrive()), defaultProcessingConfig);
    const sparse = moveTiles(kept(sparseTrain()), defaultProcessingConfig);
    expect(dense.size).toBeGreaterThan(5);
    // The train's 30 km in a few points still asks for the tiles between them.
    const points = kept(sparseTrain());
    const pointTiles = new Set(
      points.map((point) => tileKey(14, lonToTileX(point.lon, 14), latToTileY(point.lat, 14))),
    );
    expect(sparse.size).toBeGreaterThan(pointTiles.size * 2);
    for (const tile of pointTiles) expect(sparse.has(tile)).toBe(true);
  });
});

describe("the configuration", () => {
  it("takes the thresholds and the tile age the environment sets", () => {
    const config = processingConfigWith({ maxAccuracyM: 80, stopMinS: 240, osmTtlDays: 30 });
    expect(config.averaging.maxAccuracyM).toBe(80);
    expect(config.stops.minDurationS).toBe(240);
    expect(config.mapping.tileMaxAgeDays).toBe(30);
    expect(config.mapping.pieceMaxTiles).toBe(defaultProcessingConfig.mapping.pieceMaxTiles);
    expect(config.passes).toEqual({ maxPoints: 60_000, maxSpanS: 36 * 3600 });
  });

  it("bounds a pass as the environment says", () => {
    const config = processingConfigWith({
      maxAccuracyM: 150,
      stopMinS: 180,
      osmTtlDays: 90,
      passMaxPoints: 20_000,
      passMaxSpanHours: 12,
    });
    expect(config.passes).toEqual({ maxPoints: 20_000, maxSpanS: 12 * 3600 });
    expect(config.stops).toEqual(defaultProcessingConfig.stops);
  });
});

describe("the backfill's level", () => {
  const recorded = (averaged: number, mapped: number, inferred: number) => ({
    versions: { averaged, mapped, inferred },
  });
  const current = { averaged: 1, mapped: 1, inferred: 2 };

  it("works out a history never processed from averaging on", () => {
    expect(backfillLevel(null, current)).toBe("averaged");
    expect(backfillLevel({}, current)).toBe("averaged");
    expect(backfillLevel("version 1", current)).toBe("averaged");
  });

  it("reads a single version as every level's", () => {
    expect(backfillLevel({ version: 1 }, current)).toBe("inferred");
    expect(backfillLevel({ version: 1 }, { averaged: 1, mapped: 1, inferred: 1 })).toBeNull();
    expect(backfillLevel({ version: 0 }, current)).toBe("averaged");
    // What production recorded before the levels had versions: only the inference runs again.
    expect(backfillLevel({ version: 1 }, processingVersions)).toBe("inferred");
  });

  it("starts at the lowest level whose version changed, or nowhere", () => {
    expect(backfillLevel(recorded(1, 1, 2), current)).toBeNull();
    expect(backfillLevel(recorded(1, 1, 2), { averaged: 1, mapped: 1, inferred: 3 })).toBe(
      "inferred",
    );
    expect(backfillLevel(recorded(1, 1, 2), { averaged: 1, mapped: 2, inferred: 3 })).toBe(
      "mapped",
    );
    expect(backfillLevel(recorded(1, 1, 2), { averaged: 2, mapped: 2, inferred: 3 })).toBe(
      "averaged",
    );
    // Going back to older algorithms is a change too.
    expect(backfillLevel(recorded(1, 1, 3), current)).toBe("inferred");
  });

  it("counts a level missing from the record as changed", () => {
    expect(backfillLevel({ versions: { averaged: 1, mapped: 1 } }, current)).toBe("inferred");
    expect(backfillLevel({ versions: { averaged: 1, inferred: 2 } }, current)).toBe("mapped");
  });
});

describe("timeline cursors", () => {
  it("round-trip and refuse anything else", () => {
    const cursor = {
      startedAt: "2026-10-26T07:33:20.000Z",
      deviceId: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    };
    expect(decodeTimelineCursor(encodeTimelineCursor(cursor))).toEqual(cursor);
    expect(() => decodeTimelineCursor("bm9wZQ")).toThrow();
    expect(() =>
      decodeTimelineCursor(Buffer.from("2026-10-26|not-a-uuid").toString("base64url")),
    ).toThrow();
  });
});
