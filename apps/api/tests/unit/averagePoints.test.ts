import { describe, expect, it } from "vitest";
import { averagePoints } from "../../src/processing/averagePoints";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { haversineM } from "../../src/tracks/haversine";
import { deskJitter, flight, sparseTrain, walkInTown } from "../support/journeys";
import { toLonLat } from "../support/syntheticWorld";

const config = defaultProcessingConfig.averaging;

/** A point `x` metres east of the world's origin at time t. */
const east = (x: number, t: number, extra: Partial<RawPoint> = {}): RawPoint => {
  const [lon, lat] = toLonLat(x, 0);
  return {
    t,
    lat,
    lon,
    accuracy: 5,
    speed: null,
    altitude: null,
    verticalAccuracy: null,
    motion: [],
    ...extra,
  };
};

describe("averagePoints", () => {
  it("returns one entry per point, in order", () => {
    const points = walkInTown();
    const averaged = averagePoints(points, config);
    expect(averaged).toHaveLength(points.length);
    expect(averaged.map((point) => point.t)).toEqual(points.map((point) => point.t));
  });

  it("drops points less accurate than the limit", () => {
    const points = [
      east(0, 0),
      east(10, 10, { accuracy: 151 }),
      east(20, 20),
      east(30, 30, { accuracy: 150 }),
    ];
    expect(averagePoints(points, config).map((point) => point.kept)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it("drops a spike and a short run of them, but not the points around", () => {
    // Walking east at 1.5 m/s, with a glitch 3 km off and a two-fix glitch 5 km off.
    const points = Array.from({ length: 40 }, (_, index) => east(index * 15, index * 10));
    points[10] = east(3000, 100);
    points[25] = east(5000, 250);
    points[26] = east(5010, 260);
    const kept = averagePoints(points, config).map((point) => point.kept);
    expect(kept.filter((value) => !value)).toHaveLength(3);
    expect(kept[10]).toBe(false);
    expect(kept[25]).toBe(false);
    expect(kept[26]).toBe(false);
    expect(kept[9]).toBe(true);
    expect(kept[11]).toBe(true);
  });

  it("drops a first point the next two disagree with", () => {
    const points = [east(9000, 0), east(0, 10), east(15, 20), east(30, 30)];
    expect(averagePoints(points, config).map((point) => point.kept)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it("keeps a flight: fast points that agree with each other are no spikes", () => {
    const averaged = averagePoints(flight(), config);
    expect(averaged.every((point) => point.kept)).toBe(true);
  });

  it("collapses a phone lying still to one position", () => {
    const points = deskJitter();
    const averaged = averagePoints(points, config);
    expect(averaged.every((point) => point.stationary)).toBe(true);
    expect(new Set(averaged.map((point) => `${point.lat}:${point.lon}`)).size).toBe(1);
    // The centroid lies where the phone was, within a metre or two.
    const raw = points.reduce(
      (sum, point) => ({
        lat: sum.lat + point.lat / points.length,
        lon: sum.lon + point.lon / points.length,
      }),
      { lat: 0, lon: 0 },
    );
    expect(haversineM(raw, averaged[0] ?? raw)).toBeLessThan(2);
    expect(averaged.every((point) => point.speed === 0)).toBe(true);
  });

  it("smooths a slow, noisy walk", () => {
    const points = walkInTown();
    const averaged = averagePoints(points, config);
    // The averaged line is shorter: the zigzag of the noise is gone.
    const length = (track: readonly { lat: number; lon: number }[]) =>
      track
        .slice(1)
        .reduce((sum, point, index) => sum + haversineM(track[index] ?? point, point), 0);
    expect(length(averaged)).toBeLessThan(0.8 * length(points));
    expect(length(averaged)).toBeGreaterThan(3500);
  });

  it("leaves sparse points as they are", () => {
    const points = sparseTrain().slice(6, 12);
    const averaged = averagePoints(points, config);
    for (const [index, point] of points.entries()) {
      expect(averaged[index]?.lat).toBe(point.lat);
      expect(averaged[index]?.lon).toBe(point.lon);
    }
  });

  it("takes the median of the reported and the derived speeds", () => {
    const points = [
      east(0, 0, { speed: 2 }),
      east(20, 10, { speed: 2 }),
      east(40, 20, { speed: 50 }),
      east(60, 30, { speed: 2 }),
    ];
    const averaged = averagePoints(points, config);
    // The third point reports 50 m/s; the points around it say 2 m/s.
    expect(averaged[2]?.speed).toBeCloseTo(2, 0);
  });
});
