import { describe, expect, it } from "vitest";
import { trackDistance } from "../../src/tracks/distanceAccumulator";
import { haversineM } from "../../src/tracks/haversine";

const ghent = { lat: 51.0543, lon: 3.7174 };
/** `metres` north of Ghent. */
const north = (metres: number, t: number, accuracy: number | null = 5) => ({
  lat: ghent.lat + metres / 111_195,
  lon: ghent.lon,
  t,
  accuracy,
});

describe("haversineM", () => {
  it("measures great-circle distances", () => {
    // One degree of latitude is ~111.2 km on the mean-radius sphere.
    expect(haversineM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -1);
    // Ghent → Deinze, ~15 km as the crow flies.
    const deinze = haversineM(ghent, { lat: 50.9855, lon: 3.533 });
    expect(deinze).toBeGreaterThan(14_500);
    expect(deinze).toBeLessThan(15_500);
  });
});

describe("trackDistance", () => {
  it("adds up real movement", () => {
    const points = Array.from({ length: 11 }, (_, index) => north(index * 100, index * 20));
    expect(trackDistance(points)).toBeCloseTo(1000, 0);
  });

  it("ignores GPS jitter around a standing phone", () => {
    const jitter = Array.from({ length: 200 }, (_, index) =>
      north(index % 2 === 0 ? 0 : 12, index * 5, 10),
    );
    expect(trackDistance(jitter)).toBe(0);
  });

  it("requires a step larger than the mean accuracy of both points", () => {
    // 40 m steps with 100 m accuracy are noise; with 5 m accuracy they are movement.
    const coarse = [north(0, 0, 100), north(40, 30, 100), north(80, 60, 100)];
    expect(trackDistance(coarse)).toBe(0);
    const fine = [north(0, 0, 5), north(40, 30, 5), north(80, 60, 5)];
    expect(trackDistance(fine)).toBeCloseTo(80, 0);
  });

  it("measures from an anchor, so slow walking still counts", () => {
    const slow = Array.from({ length: 101 }, (_, index) => north(index * 2, index * 2));
    expect(trackDistance(slow)).toBeGreaterThan(180);
  });

  it("skips glitches faster than 350 m/s", () => {
    const glitch = [north(0, 0), north(100, 20), north(50_000, 21), north(200, 40)];
    expect(trackDistance(glitch)).toBeCloseTo(200, 0);
  });

  it("treats unknown accuracy as exact (the 15 m floor still applies)", () => {
    expect(trackDistance([north(0, 0, null), north(10, 10, null)])).toBe(0);
    expect(trackDistance([north(0, 0, null), north(30, 10, null)])).toBeCloseTo(30, 0);
  });
});
