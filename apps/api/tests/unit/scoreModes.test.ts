import { describe, expect, it } from "vitest";
import type { MoveFeatures } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { scoreModes } from "../../src/processing/scoreModes";

/** A move at `p85` km/h with nothing else known: no map, no CoreMotion. */
const bare = (p85: number, extra: Partial<MoveFeatures> = {}): MoveFeatures => ({
  durationS: 900,
  distanceM: (p85 / 3.6) * 900,
  points: 100,
  speed: { median: p85 * 0.9, p85, max: p85 * 1.1, average: p85 * 0.85 },
  accelerationVariance: null,
  ways: null,
  near: null,
  corridor: null,
  dwells: null,
  ends: null,
  passed: null,
  motion: { stationary: 0, walking: 0, running: 0, cycling: 0, automotive: 0, coverage: 0 },
  tripMode: null,
  altitude: { maxM: null, climbMs: null },
  extentM: (p85 / 3.6) * 900,
  ...extra,
});

describe("scoreModes", () => {
  it("is sure about a clear case", () => {
    const verdict = scoreModes(
      bare(5, {
        motion: { stationary: 0, walking: 1, running: 0, cycling: 0, automotive: 0, coverage: 1 },
      }),
      defaultProcessingConfig,
    );
    expect(verdict.mode).toBe("walking");
    expect(verdict.confidence).toBeGreaterThan(defaultProcessingConfig.review.reviewBelow);
  });

  it("gives confidence = winner / sum of all scores", () => {
    const verdict = scoreModes(bare(14), defaultProcessingConfig);
    const total = Object.values(verdict.scores).reduce((sum, score) => sum + score, 0);
    expect(verdict.confidence).toBeCloseTo(Math.max(...Object.values(verdict.scores)) / total, 2);
  });

  it("flags an ambiguous move for review: 14 km/h could be running or cycling", () => {
    const verdict = scoreModes(bare(14), defaultProcessingConfig);
    expect(["running", "cycling"]).toContain(verdict.mode);
    expect(verdict.confidence).toBeLessThan(defaultProcessingConfig.review.reviewBelow);
    expect(verdict.confidence).toBeGreaterThanOrEqual(defaultProcessingConfig.review.unknownBelow);
  });

  it("says unknown below the minimum confidence", () => {
    const strict = {
      ...defaultProcessingConfig,
      review: { unknownBelow: 0.7, reviewBelow: 0.8 },
    };
    const verdict = scoreModes(bare(14), strict);
    expect(verdict.mode).toBe("unknown");
    expect(verdict.confidence).toBeLessThan(0.7);
    // With no evidence at all, nothing wins.
    const nothing = scoreModes(bare(0, { extentM: 5000 }), defaultProcessingConfig);
    expect(nothing.mode).toBe("unknown");
    expect(nothing.confidence).toBe(0);
  });

  it("gives an Overland trip's mode a strong lead", () => {
    const verdict = scoreModes(bare(14, { tripMode: "running" }), defaultProcessingConfig);
    expect(verdict.mode).toBe("running");
    expect(verdict.confidence).toBeGreaterThan(defaultProcessingConfig.review.reviewBelow);
  });

  it("doubts a fast move without map data: car or train, for review", () => {
    const verdict = scoreModes(bare(110), defaultProcessingConfig);
    expect(["car", "train"]).toContain(verdict.mode);
    expect(verdict.scores.car).toBeGreaterThan(0);
    expect(verdict.scores.train).toBeGreaterThan(0);
    expect(verdict.confidence).toBeLessThan(defaultProcessingConfig.review.reviewBelow);
  });
});
