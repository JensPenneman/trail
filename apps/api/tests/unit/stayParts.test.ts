import { describe, expect, it } from "vitest";
import { continuesStop, metresBetween, type StopShape } from "../../src/processing/stayParts";
import { haversineM } from "../../src/tracks/haversine";
import { toLonLat, type Vertex } from "../support/syntheticWorld";

const position = ([x, y]: Vertex) => {
  const [lon, lat] = toLonLat(x, y);
  return { lat, lon };
};

/** A stop of an hour from `startT` with its middle at `at`, its ends there unless given. */
function stop(
  startT: number,
  at: Vertex,
  options: { start?: Vertex; end?: Vertex; spreadM?: number } = {},
): StopShape {
  return {
    startT,
    endT: startT + 3600,
    start: position(options.start ?? at),
    end: position(options.end ?? at),
    centroid: position(at),
    spreadM: options.spreadM ?? 20,
  };
}

describe("continuesStop", () => {
  it("reads the parts of a stay as the timeline serves them", () => {
    // Middles 120 m apart: one stay where they meet at the point they share …
    expect(
      continuesStop(stop(0, [0, 0], { end: [60, 0] }), stop(3600, [120, 0], { start: [60, 0] })),
    ).toBe(true);
    // … two a ten-minute hole apart, one at 90 m, and one 140 m apart where they spread 150 m.
    expect(continuesStop(stop(0, [0, 0]), stop(4200, [120, 0]))).toBe(false);
    expect(continuesStop(stop(0, [0, 0]), stop(4200, [90, 0]))).toBe(true);
    expect(
      continuesStop(stop(0, [0, 0], { spreadM: 150 }), stop(4200, [140, 0], { spreadM: 150 })),
    ).toBe(true);
    // Where the next begins 400 m from where the one before ended: two.
    expect(continuesStop(stop(0, [0, 0]), stop(3600, [400, 0]))).toBe(false);
    // Two hours without a point and 500 m between: travel, however far the two spread.
    expect(
      continuesStop(stop(0, [0, 0], { spreadM: 600 }), stop(10_800, [500, 0], { spreadM: 600 })),
    ).toBe(false);
  });

  it("measures close positions as the great circle does", () => {
    const from = position([0, 0]);
    for (const at of [
      [120, 0],
      [0, 300],
      [200, -200],
    ] as const) {
      expect(metresBetween(from, position(at))).toBeCloseTo(haversineM(from, position(at)), 0);
    }
  });
});
