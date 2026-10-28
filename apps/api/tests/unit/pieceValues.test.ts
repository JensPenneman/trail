import { describe, expect, it } from "vitest";
import { type PiecePoint, pieceValues } from "../../src/processing/pieceValues";
import { haversineM } from "../../src/tracks/haversine";

const point = (
  t: number,
  lat: number,
  lon: number,
  fields: Partial<PiecePoint> = {},
): PiecePoint => ({
  t,
  latAvg: lat,
  lonAvg: lon,
  latMap: null,
  lonMap: null,
  pathMap: null,
  speed: 0,
  accuracy: 10,
  ...fields,
});

describe("pieceValues", () => {
  it("gives the part of a move only its own distance, points and speed", () => {
    // Two matched points with the road's bend between them, then one off the map.
    const points = [
      point(1000, 51.0, 3.7, { latMap: 51.0, lonMap: 3.7, speed: 14 }),
      point(1060, 51.005, 3.7, {
        latMap: 51.005,
        lonMap: 3.7,
        pathMap: [[3.705, 51.0025]],
        speed: 14,
      }),
      point(1120, 51.01, 3.7, { speed: 14 }),
    ];
    const whole = {
      durationS: 9000,
      distanceM: 90_000,
      points: 900,
      speed: { max: 120, average: 36 },
      scores: { car: 0.9 },
    };
    const values = pieceValues("move", points, { startT: 1000, endT: 1120 }, whole);
    const along =
      haversineM({ lat: 51.0, lon: 3.7 }, { lat: 51.0025, lon: 3.705 }) +
      haversineM({ lat: 51.0025, lon: 3.705 }, { lat: 51.005, lon: 3.7 }) +
      haversineM({ lat: 51.005, lon: 3.7 }, { lat: 51.01, lon: 3.7 });
    expect(values.pointCount).toBe(3);
    expect(values.distanceM).toBeCloseTo(along, 0);
    expect(values.start).toEqual({ lat: 51.0, lon: 3.7 });
    expect(values.end).toEqual({ lat: 51.01, lon: 3.7 });
    expect(values.centroid?.lat).toBeCloseTo(51.005, 6);
    expect(values.features).toMatchObject({
      durationS: 120,
      distanceM: values.distanceM,
      points: 3,
      scores: { car: 0.9 },
    });
    expect(values.features["speed"]).toEqual({
      max: 120,
      average: Math.round((values.distanceM / 120) * 3.6 * 100) / 100,
    });
  });

  it("gives the part of a stop its own spread, middle and last point", () => {
    // Still at two spots 100 m apart; one fix in between at speed does not count for the spread.
    const points = [
      point(0, 51.0, 3.7),
      point(600, 51.0, 3.7),
      point(900, 51.0005, 3.7, { speed: 8 }),
      point(1200, 51.0009, 3.7),
    ];
    const values = pieceValues(
      "stop",
      points,
      { startT: 0, endT: 4000 },
      { spreadM: 900, lastPointT: 3000 },
    );
    expect(values.pointCount).toBe(4);
    expect(values.distanceM).toBe(0);
    expect(values.features["spreadM"]).toBeCloseTo(100, -1);
    expect(values.features["lastPointT"]).toBe(1200);
    expect(values.centroid?.lat).toBeGreaterThan(51.0);
    expect(values.centroid?.lat).toBeLessThan(51.0009);
  });

  it("keeps the stored places of a part without a point of its own", () => {
    const stop = pieceValues("stop", [], { startT: 0, endT: 600 }, { spreadM: 40, lastPointT: -5 });
    expect(stop).toEqual({
      pointCount: 0,
      distanceM: 0,
      start: null,
      end: null,
      centroid: null,
      features: { spreadM: 0, lastPointT: -5 },
    });
    const move = pieceValues("move", [], { startT: 0, endT: 600 }, { distanceM: 5000 });
    expect([move.pointCount, move.distanceM, move.features["distanceM"]]).toEqual([0, 0, 0]);
  });
});
