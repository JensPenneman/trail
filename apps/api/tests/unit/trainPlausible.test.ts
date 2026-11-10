import { describe, expect, it } from "vitest";
import type { KeptPoint } from "../../src/processing/keptPoint";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { couldBeTrain, trainLikeM } from "../../src/processing/rail/trainPlausible";
import { planWindow } from "../../src/processing/runPipeline";
import { bikeRide, walkInTown } from "../support/journeys";

const config = defaultProcessingConfig.rail;
const mPerDegree = 111_320;

/** A synthetic kept point `x` metres east of the origin at `t` seconds; `speed` is what averaging stored. */
const point = (index: number, t: number, x: number, speed: number, jitter = 0): KeptPoint => ({
  index,
  t,
  lat: 51 + jitter / mPerDegree,
  lon: 3.7 + x / (mPerDegree * Math.cos((51 * Math.PI) / 180)),
  speed,
  accuracy: 8,
  stationary: false,
  reportedSpeed: null,
  altitude: null,
  verticalAccuracy: null,
  motion: [],
});

/** A deterministic wobble of a few metres, as a phone gives at 1 Hz. */
const wobble = (n: number): number => 3 * Math.sin(n * 12.9898) * Math.cos(n * 4.1414);

/** Minutes on foot at 1 Hz (1.4 m/s), then a train at 25 m/s for `trainS` seconds, one fix in `every`. */
function walkThenTrain(walkS: number, trainS: number, every = 1): KeptPoint[] {
  const points: KeptPoint[] = [];
  for (let s = 0; s < walkS; s += 1) {
    points.push(point(points.length, s, 1.4 * s + wobble(s), 1.4, wobble(s + 1)));
  }
  const x0 = 1.4 * walkS;
  for (let s = 0; s <= trainS; s += every) {
    points.push(point(points.length, walkS + s, x0 + 25 * s, 25));
  }
  return points;
}

describe("couldBeTrain: distance at train speed, not a share of the points", () => {
  it("passes a ride whose points mostly lie in stations (a low p90 of the point speeds)", () => {
    // Ten minutes of fixes in a station, then five fixes a minute apart on 9 km of line: the speed
    // the points carry is 0 for nearly all of them, the chords between the last few are 25 m/s.
    const points: KeptPoint[] = [];
    for (let s = 0; s < 600; s += 2) points.push(point(points.length, s, 3 + wobble(s), 0));
    for (let k = 1; k <= 6; k += 1) points.push(point(points.length, 600 + k * 60, 1500 * k, 25));
    const sorted = points.map((entry) => entry.speed).sort((a, b) => a - b);
    expect(sorted[Math.floor(0.9 * sorted.length)]).toBe(0);
    expect(trainLikeM(points, config)).toBeGreaterThan(8000);
    expect(couldBeTrain(points, config)).toBe(true);
  });

  it("passes half an hour on foot followed by three minutes of train in one move", () => {
    expect(couldBeTrain(walkThenTrain(1800, 180), config)).toBe(true);
  });

  it("passes the same with the train's fixes thinned to one in ten", () => {
    expect(couldBeTrain(walkThenTrain(1800, 180, 10), config)).toBe(true);
  });

  it("refuses a walk in town, a bike ride and a 900 m train", () => {
    for (const points of [walkInTown(), bikeRide()]) {
      const plan = planWindow(points, [], defaultProcessingConfig);
      expect(plan.moves.length).toBeGreaterThan(0);
      for (const move of plan.moves) {
        expect(couldBeTrain(plan.kept.slice(move.first, move.last + 1), config)).toBe(false);
      }
    }
    expect(couldBeTrain(walkThenTrain(0, 36), config)).toBe(false);
  });

  it("always passes a move a person set to train, however short", () => {
    const short = walkThenTrain(0, 16);
    expect(couldBeTrain(short, config)).toBe(false);
    expect(couldBeTrain(short, config, true)).toBe(true);
    // Still nothing to align in a single point.
    expect(couldBeTrain(short.slice(0, 1), config, true)).toBe(false);
  });
});
