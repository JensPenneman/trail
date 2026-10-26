import { describe, expect, it } from "vitest";
import { averagePoints } from "../../src/processing/averagePoints";
import { detectStops } from "../../src/processing/detectStops";
import { keptPoints } from "../../src/processing/keptPoint";
import type { RawPoint, VisitSpan } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { morning, walkInTown } from "../support/journeys";
import { concat, lastT, stay, toLonLat, travel } from "../support/syntheticWorld";

const spansOf = (points: readonly RawPoint[], visits: readonly VisitSpan[] = []) => {
  const kept = keptPoints(points, averagePoints(points, defaultProcessingConfig.averaging));
  return detectStops(kept, visits, defaultProcessingConfig.stops).map((span) => ({
    kind: span.kind,
    from: span.startT - morning,
    to: span.endT - morning,
  }));
};

const street = [
  [0, -2000],
  [2000, -2000],
] as const;

describe("detectStops", () => {
  it("finds a stay of three minutes or more, and nothing in a walk", () => {
    expect(spansOf(walkInTown()).map((span) => span.kind)).toEqual(["move"]);
    const walk = travel(street, {
      startT: morning,
      speedMs: 1.4,
      intervalS: 1,
      motion: ["walking"],
    });
    const shop = stay([2000, -2000], { startT: lastT(walk) + 1, durationS: 600, intervalS: 5 });
    const back = travel([...street].reverse(), {
      startT: lastT(shop) + 1,
      speedMs: 1.4,
      intervalS: 1,
      motion: ["walking"],
    });
    expect(spansOf(concat(walk, shop, back)).map((span) => span.kind)).toEqual([
      "move",
      "stop",
      "move",
    ]);
  });

  it("does not stop for a short wait", () => {
    const walk = travel(street, { startT: morning, speedMs: 1.4, intervalS: 1 });
    const wait = stay([2000, -2000], { startT: lastT(walk) + 1, durationS: 150, intervalS: 5 });
    const on = travel(
      [
        [2000, -2000],
        [4000, -2000],
      ],
      { startT: lastT(wait) + 1, speedMs: 1.4, intervalS: 1 },
    );
    expect(spansOf(concat(walk, wait, on)).map((span) => span.kind)).toEqual(["move"]);
  });

  it("shares the boundary points: moves start where stops end", () => {
    const home = stay([0, -2000], { startT: morning, durationS: 900, intervalS: 10 });
    const walk = travel(street, { startT: lastT(home) + 10, speedMs: 1.4, intervalS: 1 });
    const spans = spansOf(concat(home, walk));
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move"]);
    expect(spans[0]?.to).toBe(spans[1]?.from);
  });

  it("keeps the stop through a recording pause that resumes nearby", () => {
    // iOS pauses after ten minutes still, and resumes outside its 100 m geofence hours later.
    const home = stay([0, -2000], { startT: morning, durationS: 600, intervalS: 10 });
    const resumedAt = lastT(home) + 3 * 3600;
    const walk = travel(
      [
        [100, -2000],
        [2000, -2000],
      ],
      { startT: resumedAt, speedMs: 1.4, intervalS: 1 },
    );
    const spans = spansOf(concat(home, walk));
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move"]);
    expect(spans[0]?.to).toBe(resumedAt - morning);
    expect(spans[1]?.from).toBe(resumedAt - morning);
  });

  it("leaves a gap without travel out of every segment", () => {
    // The phone died at 08:10 and came back at home in the evening.
    const walk = travel(street, { startT: morning, speedMs: 1.4, intervalS: 1 });
    const later = travel(
      [
        [2100, -2000],
        [3000, -2000],
      ],
      { startT: lastT(walk) + 8 * 3600, speedMs: 1.4, intervalS: 1 },
    );
    const spans = spansOf(concat(walk, later));
    expect(spans.map((span) => span.kind)).toEqual(["move", "move"]);
    expect((spans[1]?.from ?? 0) - (spans[0]?.to ?? 0)).toBeGreaterThan(7 * 3600);
  });

  it("keeps a fast gap inside the move (a flight, a tunnel)", () => {
    const before = travel(
      [
        [0, 0],
        [3000, 0],
      ],
      { startT: morning, speedMs: 30, intervalS: 1 },
    );
    const after = travel(
      [
        [100_000, 0],
        [103_000, 0],
      ],
      { startT: lastT(before) + 3200, speedMs: 30, intervalS: 1 },
    );
    expect(spansOf(concat(before, after)).map((span) => span.kind)).toEqual(["move"]);
  });

  it("turns an iOS visit into a stop even where GPS drifts", () => {
    // Indoors the fixes wander 80 m around; iOS reported the visit.
    const drifting = stay([0, -2000], {
      startT: morning,
      durationS: 900,
      intervalS: 5,
      noiseM: 45,
      accuracy: 40,
    });
    const [lon, lat] = toLonLat(0, -2000);
    const visit: VisitSpan = {
      arrivedAt: morning,
      departedAt: morning + 900,
      lat,
      lon,
      accuracy: 50,
    };
    const withVisit = spansOf(drifting, [visit]);
    expect(withVisit.map((span) => span.kind)).toEqual(["stop"]);
  });

  it("stops where CoreMotion says stationary throughout", () => {
    const drifting = stay([0, -2000], {
      startT: morning,
      durationS: 900,
      intervalS: 5,
      noiseM: 45,
      accuracy: 40,
      motion: ["stationary"],
    });
    expect(spansOf(drifting).map((span) => span.kind)).toEqual(["stop"]);
  });

  it("joins two stops a short wander apart", () => {
    const first = stay([0, -2000], { startT: morning, durationS: 600, intervalS: 5, noiseM: 3 });
    const wander = travel(
      [
        [0, -2000],
        [45, -2000],
        [50, -1990],
      ],
      { startT: lastT(first) + 5, speedMs: 1, intervalS: 2 },
    );
    const second = stay([50, -1990], {
      startT: lastT(wander) + 5,
      durationS: 600,
      intervalS: 5,
      noiseM: 3,
    });
    expect(spansOf(concat(first, wander, second)).map((span) => span.kind)).toEqual(["stop"]);
  });
});
