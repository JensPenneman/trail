import type { WayKind } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import { extractFeatures } from "../../src/processing/extractFeatures";
import type { KeptPoint } from "../../src/processing/keptPoint";
import { moveSeries } from "../../src/processing/moveSeries";
import { pieceValues } from "../../src/processing/pieceValues";
import type { MappedPoint } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { morning } from "../support/journeys";
import { toLonLat } from "../support/syntheticWorld";

const config = defaultProcessingConfig.features;

/** A kept point `x` metres east of the synthetic world's origin, a minute after the one before. */
const kept = (index: number, x: number): KeptPoint => {
  const [lon, lat] = toLonLat(x, 0);
  return {
    index,
    t: morning + 60 * index,
    lat,
    lon,
    speed: 1.5,
    accuracy: 5,
    stationary: false,
    reportedSpeed: null,
    altitude: null,
    verticalAccuracy: null,
    motion: [],
  };
};

const onWay = (point: KeptPoint, wayId: number | null, wayKind: WayKind | null): MappedPoint => ({
  lat: point.lat,
  lon: point.lon,
  wayId,
  wayKind,
  snapM: 0,
  path: null,
});

/** The totals of a move whose points are `x` metres east, matched to `ways` (id, or null for none). */
function totalsOf(xs: readonly number[], ways: readonly (number | null)[] | null) {
  const points = xs.map((x, index) => kept(index, x));
  const mapped =
    ways === null
      ? null
      : points.map((point, index) => onWay(point, ways[index] ?? null, "residential"));
  return extractFeatures(
    moveSeries(points, mapped, null, config),
    { first: 0, last: points.length - 1, withEnds: true },
    [],
    config,
  ).wayTotals;
}

describe("the metres on each way of a move", () => {
  it("give each end of an interval half of it, most first", () => {
    // Points at 0 and 100 m on way 7, at 400 m on way 9: way 7 has 100 m of the first interval and
    // half of the second (150 m), way 9 the other half.
    const totals = totalsOf([0, 100, 400], [7, 7, 9]);
    expect(totals).toEqual([
      [7, 250],
      [9, 150],
    ]);
  });

  it("leave out ways under 25 m and points on no way", () => {
    // Way 3 holds one point with 10 m of interval on each side: 20 m, under the limit.
    const totals = totalsOf([0, 10, 20, 220], [null, 3, null, 5]);
    expect(totals).toEqual([[5, 100]]);
  });

  it("keep the 64 longest ways, and the lowest id among equals", () => {
    const xs = Array.from({ length: 80 }, (_, index) => index * 100);
    const ways = xs.map((_, index) => 1000 + index);
    const totals = totalsOf(xs, ways) ?? [];
    expect(totals).toHaveLength(64);
    expect(totals[0]?.[0]).toBe(1001);
    // Each way is a point's two half intervals: 100 m, the first and last point 50 m.
    expect(totals.at(-1)?.[1]).toBe(100);
  });

  it("are null without map data", () => {
    expect(totalsOf([0, 100, 200], null)).toBeNull();
  });
});

describe("the metres on each way of a piece of a move", () => {
  it("are the whole move's in proportion to the piece's distance", () => {
    const point = (t: number, lon: number) => ({
      t,
      latAvg: 51,
      lonAvg: lon,
      latMap: null,
      lonMap: null,
      pathMap: null,
      speed: 5,
      accuracy: 5,
    });
    const stored = {
      durationS: 600,
      distanceM: 1000,
      points: 10,
      wayTotals: [
        [1, 800],
        [2, 200],
      ],
    };
    const piece = pieceValues(
      "move",
      [point(0, 3.7), point(60, 3.7 + 0.0045)],
      { startT: 0, endT: 60 },
      stored,
    );
    const factor = piece.distanceM / 1000;
    expect(piece.features["wayTotals"]).toEqual([
      [1, Math.round(800 * factor * 10) / 10],
      [2, Math.round(200 * factor * 10) / 10],
    ]);
    // A piece without points has no distance and so no ways.
    expect(pieceValues("move", [], { startT: 0, endT: 600 }, stored).features["wayTotals"]).toEqual(
      [],
    );
  });
});
