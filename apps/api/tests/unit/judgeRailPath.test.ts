import { describe, expect, it } from "vitest";
import type { KeptPoint } from "../../src/processing/keptPoint";
import type { RailPoint } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { judgeRailPath } from "../../src/processing/rail/judgeRailPath";

const config = defaultProcessingConfig.rail.judge;
const metresPerDegreeLon = 111_195 * Math.cos((51 * Math.PI) / 180);

/** `count` points `spacingM` apart eastwards, `seconds` apart. */
function part(count: number, spacingM = 500, seconds = 20) {
  const points: KeptPoint[] = Array.from({ length: count }, (_, index) => ({
    index,
    t: 1_800_000_000 + index * seconds,
    lat: 51,
    lon: 3.7 + (index * spacingM) / metresPerDegreeLon,
    speed: spacingM / seconds,
    accuracy: 10,
    stationary: false,
    reportedSpeed: null,
    altitude: null,
    verticalAccuracy: null,
    motion: [],
  }));
  const rail: RailPoint[] = points.map((point, index) => ({
    lat: point.lat,
    lon: point.lon,
    wayId: 1,
    run: 0,
    step: true,
    outlier: false,
    offsetM: 5,
    z: 0.5,
    routed: true,
    legM: index === 0 ? 0 : spacingM,
    bridgedLegM: 0,
    path: null,
  }));
  return { points, rail };
}

const judge = (
  input: ReturnType<typeof part>,
  override: Partial<typeof config> = {},
  source: "cache" | "region" | null = "cache",
) => judgeRailPath(input.points, input.rail, { ...config, ...override }, source);

/** The rail point at `index`. */
function at(input: ReturnType<typeof part>, index: number): RailPoint {
  const point = input.rail[index];
  if (point === undefined) throw new Error(`no point ${index}`);
  return point;
}

/** Applies `change` to the points of a share of the part, counted from its end. */
function lastShare(
  input: ReturnType<typeof part>,
  share: number,
  change: (point: RailPoint) => void,
) {
  const from = Math.ceil(input.rail.length * (1 - share));
  for (const point of input.rail.slice(from)) change(point);
  return input;
}

describe("judgeRailPath", () => {
  it("accepts a long part that lies on the rails", () => {
    const verdict = judge(part(21), {}, "region");
    expect(verdict).toEqual({
      status: "aligned",
      reason: "ok",
      source: "region",
      coveredShare: 1,
      routedShare: 1,
      medianZ: 0.5,
      p90Z: 0.5,
      medianOffsetM: 5,
      outlierShare: 0,
      lengthM: 10_000,
    });
    expect(Object.keys(verdict)).not.toContain("lat");
  });

  it("calls a part under a kilometre, or under three steps, short", () => {
    expect(judge(part(2, 400))).toMatchObject({ status: "poor", reason: "short", lengthM: 400 });
    const short = part(21, 400);
    for (const point of short.rail.slice(2)) point.step = false;
    expect(judge(short)).toMatchObject({ status: "poor", reason: "short" });
  });

  it("says no_rail when under half of the length is inside a run, poor/coverage under 0.9", () => {
    const some = part(21);
    lastShare(some, 0.15, (point) => {
      point.run = -1;
      point.lat = null;
      point.lon = null;
      point.offsetM = null;
      point.z = null;
      point.legM = 0;
    });
    expect(judge(some)).toMatchObject({ status: "poor", reason: "coverage", coveredShare: 0.85 });
    const little = part(21);
    lastShare(little, 0.6, (point) => {
      point.run = -1;
      point.legM = 0;
    });
    expect(judge(little)).toMatchObject({ status: "no_rail", reason: "no_rail" });
    const none = part(21);
    for (const point of none.rail) point.run = -1;
    expect(judge(none)).toMatchObject({ status: "no_rail", coveredShare: 0 });
  });

  it("counts a change of run as uncovered ground between them", () => {
    const split = part(21);
    for (const point of split.rail.slice(10)) point.run = 1;
    expect(judge(split)).toMatchObject({ coveredShare: 0.95, status: "aligned" });
  });

  it("flags poor/routes when under 0.9 of the line followed the network, or a straight leg is over 2 km", () => {
    const unrouted = part(21);
    lastShare(unrouted, 0.15, (point) => {
      point.routed = false;
      point.bridgedLegM = 500;
    });
    expect(judge(unrouted)).toMatchObject({ status: "poor", reason: "routes", routedShare: 0.85 });
    const long = part(41);
    at(long, 20).routed = false;
    at(long, 20).bridgedLegM = 2500;
    expect(judge(long)).toMatchObject({ status: "poor", reason: "routes" });
    at(long, 20).bridgedLegM = 1900;
    expect(judge(long)).toMatchObject({ status: "aligned" });
  });

  it("flags poor/offsets on the median z, the p90 z and the median offset", () => {
    const median = part(21);
    for (const point of median.rail) point.z = 1.6;
    expect(judge(median)).toMatchObject({ status: "poor", reason: "offsets", medianZ: 1.6 });

    const tail = part(21);
    lastShare(tail, 0.25, (point) => {
      point.z = 3.5;
    });
    expect(judge(tail)).toMatchObject({
      status: "poor",
      reason: "offsets",
      p90Z: 3.5,
      medianZ: 0.5,
    });

    const far = part(21);
    for (const point of far.rail) point.offsetM = 61;
    expect(judge(far)).toMatchObject({ status: "poor", reason: "offsets", medianOffsetM: 61 });
  });

  it("does not align a car on a motorway 300 m from the rails: poor/offsets", () => {
    const car = part(21);
    for (const point of car.rail) {
      point.offsetM = 300;
      point.z = 300 / 15;
    }
    expect(judge(car)).toMatchObject({ status: "poor", reason: "offsets" });
  });

  it("leaves the outliers out of the offsets and flags poor/outliers over 0.15 of the duration", () => {
    const wobbly = part(21);
    for (const index of [5, 6]) {
      const point = at(wobbly, index);
      point.outlier = true;
      point.offsetM = 1500;
      point.z = 100;
    }
    expect(judge(wobbly)).toMatchObject({ status: "aligned", outlierShare: 0.1, p90Z: 0.5 });
    const many = part(21);
    for (const index of [4, 5, 6, 7]) at(many, index).outlier = true;
    expect(judge(many)).toMatchObject({ status: "poor", reason: "outliers", outlierShare: 0.2 });
  });

  it("weighs by time: a long stop with a large offset counts for its duration", () => {
    const input = part(21, 500, 20);
    // One interval of 10 minutes at a bad offset, among 19 of 20 s.
    for (const point of input.points.slice(10)) point.t += 580;
    at(input, 10).z = 4;
    expect(judge(input)).toMatchObject({ status: "poor", reason: "offsets", p90Z: 4 });
  });

  it("is a pure function of its input, whatever the source label", () => {
    const input = part(21);
    expect(judge(input, {}, null)).toEqual({ ...judge(input, {}, "cache"), source: null });
    expect(judge(input)).toEqual(judge(input));
  });
});
