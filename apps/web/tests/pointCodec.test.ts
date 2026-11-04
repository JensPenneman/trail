import type { TrackPoint } from "@trail/contracts/track";
import { trackPointSchema } from "@trail/contracts/track";
import { levelPointSchema } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  packHeatCells,
  packLevelPoints,
  packTrackPoints,
  unpackHeatCells,
  unpackLevelPoints,
  unpackTrackPoints,
} from "../src/cache/pointCodec";

/** A small deterministic generator, so a failure can be run again. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function points(count: number, next: () => number): TrackPoint[] {
  const start = 1_793_000_000;
  return Array.from({ length: count }, (_, index) => {
    const maybe = (value: number) => (next() < 0.2 ? null : value);
    return [
      -180 + next() * 360,
      -90 + next() * 180,
      start + index,
      maybe(next() * 40),
      maybe(Math.round(next() * 2000) / 10),
      maybe(-400 + next() * 9000),
    ];
  });
}

describe("pointCodec", () => {
  it("packs track points into one buffer of 48 bytes a point and back, exactly", () => {
    const original: TrackPoint[] = [
      [3.52683, 50.98452, 1_793_000_000, 0, 10, 11],
      [3.53321, 50.98612, 1_793_000_060, 5.3, 8.4, null],
      [3.54502, 50.99058, 1_793_000_120, null, null, -2.25],
    ];
    const packed = packTrackPoints(original);
    expect(packed.n).toBe(3);
    expect(packed.packed.byteLength).toBe(3 * 48);
    expect(unpackTrackPoints(packed)).toEqual(original);
    // 5.3 stays 5.3: a 32-bit float would have made it 5.300000190734863.
    expect((unpackTrackPoints(packed) as TrackPoint[])[1]?.[3]).toBe(5.3);
  });

  it("turns null into NaN on disk and back into null, only where the contract allows null", () => {
    const packed = packTrackPoints([[1, 2, 3, null, null, null]]);
    const columns = new Float64Array(packed.packed);
    expect(Number.isNaN(columns[3])).toBe(true);
    expect(unpackTrackPoints(packed)).toEqual([[1, 2, 3, null, null, null]]);
    // A NaN where a number must be stays NaN, which the schema refuses.
    columns[0] = Number.NaN;
    const damaged = unpackTrackPoints(packed) as unknown[];
    expect(trackPointSchema.safeParse(damaged[0]).success).toBe(false);
  });

  it("keeps empty tracks empty", () => {
    const packed = packTrackPoints([]);
    expect(packed.packed.byteLength).toBe(0);
    expect(unpackTrackPoints(packed)).toEqual([]);
  });

  it("packs level points and heat cells the same way", () => {
    const level: [number, number, number][] = [
      [3.71, 51.03, 1_793_000_000],
      [3.72, 51.04, 1_793_000_009],
    ];
    expect(unpackLevelPoints(packLevelPoints(level))).toEqual(level);
    const cells: [number, number, number][] = [
      [1_048_575, 524_288, 12],
      [133_773, 87_718, 4_294_967_295],
      [0, 0, 1],
    ];
    const packed = packHeatCells(cells);
    // Whole numbers as 32-bit unsigned: 12 bytes a cell.
    expect(packed.packed.byteLength).toBe(cells.length * 12);
    expect(unpackHeatCells(packed)).toEqual(cells);
    expect(unpackHeatCells(packHeatCells([]))).toEqual([]);
    expect(
      z.array(levelPointSchema).safeParse(unpackLevelPoints(packLevelPoints(level))).success,
    ).toBe(true);
  });

  it("gives level points the width of 3 plus the values asked for, nullable after the time", () => {
    const level: [number, number, number, ...(number | null)[]][] = [
      [3.71, 51.03, 1_793_000_000, 12.5, null],
      [3.72, 51.04, 1_793_000_009, null, 8],
    ];
    const packed = packLevelPoints(level, 2);
    expect(packed.width).toBe(5);
    expect(unpackLevelPoints(packed)).toEqual(level);
    expect(z.array(levelPointSchema).safeParse(unpackLevelPoints(packed)).success).toBe(true);
    // None asked: three columns, as before; a damaged first column is no answer.
    expect(packLevelPoints([[1, 2, 3]]).width).toBe(3);
    const damaged = new Float64Array(packed.packed);
    damaged[0] = Number.NaN;
    expect(
      z.array(levelPointSchema).safeParse(unpackLevelPoints({ ...packed, packed: damaged.buffer }))
        .success,
    ).toBe(false);
  });

  it("refuses heat cells it did not make, the old 64-bit float ones included", () => {
    const packed = packHeatCells([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(unpackHeatCells(null)).toBeNull();
    expect(unpackHeatCells({ ...packed, n: 3 })).toBeNull();
    expect(unpackHeatCells({ ...packed, width: 2 })).toBeNull();
    // An entry from before: 24 bytes a cell, column after column.
    const old = new Float64Array([3.71, 3.72, 51.03, 51.04, 12, 7]);
    expect(unpackHeatCells({ packed: old.buffer, n: 2, width: 3 })).toBeNull();
    // Level points are 64-bit rows, not these.
    expect(unpackHeatCells(packLevelPoints([[1, 2, 3]]))).toBeNull();
  });

  it("refuses what it did not make", () => {
    const packed = packTrackPoints([[1, 2, 3, 4, 5, 6]]);
    expect(unpackTrackPoints(null)).toBeNull();
    expect(unpackTrackPoints([[1, 2, 3, 4, 5, 6]])).toBeNull();
    expect(unpackTrackPoints({ ...packed, n: 2 })).toBeNull();
    expect(unpackTrackPoints({ ...packed, width: 3 })).toBeNull();
    // A level's points have three columns and at most three values after them.
    expect(unpackLevelPoints({ ...packed, width: 7, packed: new ArrayBuffer(56) })).toBeNull();
    expect(unpackLevelPoints({ ...packed, width: 2, packed: new ArrayBuffer(16) })).toBeNull();
    expect(unpackTrackPoints({ ...packed, packed: new ArrayBuffer(40) })).toBeNull();
  });

  it("round-trips random tracks of any length", () => {
    const next = random(20261028);
    for (let run = 0; run < 40; run += 1) {
      const original = points(Math.floor(next() * 600), next);
      const unpacked = unpackTrackPoints(packTrackPoints(original));
      expect(unpacked).toEqual(original);
      expect(z.array(trackPointSchema).safeParse(unpacked).success).toBe(true);
    }
  });

  it("packs and unpacks 50 000 points well under a second", () => {
    const original = points(50_000, random(7));
    // The best of a few runs: the suite's other workers share the CPU, and the first run
    // warms the code up, as a page's second answer finds it.
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      const unpacked = unpackTrackPoints(packTrackPoints(original));
      best = Math.min(best, performance.now() - started);
      expect(unpacked).toHaveLength(50_000);
    }
    expect(best).toBeLessThan(200);
  });
});
