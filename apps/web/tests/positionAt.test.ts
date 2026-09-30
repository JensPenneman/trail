import type { TrackPoint } from "@trail/contracts/track";
import { describe, expect, it } from "vitest";
import { positionAt } from "../src/pages/history/positionAt";

const points: TrackPoint[] = [
  [3.5, 51.0, 1000, 2, 10, 5],
  [3.6, 51.1, 1100, 4, 10, 5],
  // A pause of more than ten minutes: nothing is known in between.
  [3.7, 51.2, 2000, 0, 10, 5],
];

describe("positionAt", () => {
  it("returns recorded points exactly", () => {
    expect(positionAt(points, 1000)).toMatchObject({ lon: 3.5, lat: 51.0, interpolated: false });
    expect(positionAt(points, 2000)).toMatchObject({ lon: 3.7, lat: 51.2 });
  });

  it("interpolates between neighbours of one segment", () => {
    const halfway = positionAt(points, 1050);
    expect(halfway?.lon).toBeCloseTo(3.55);
    expect(halfway?.lat).toBeCloseTo(51.05);
    expect(halfway?.interpolated).toBe(true);
  });

  it("knows nothing in a recording gap or outside the track", () => {
    expect(positionAt(points, 1500)).toBeNull();
    expect(positionAt(points, 999)).toBeNull();
    expect(positionAt(points, 2001)).toBeNull();
    expect(positionAt([], 1000)).toBeNull();
  });
});
