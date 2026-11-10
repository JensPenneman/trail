import { describe, expect, it } from "vitest";
import type { KeptPoint } from "../../src/processing/keptPoint";
import { LocalProjection } from "../../src/processing/localProjection";
import type { MapData } from "../../src/processing/mapData";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { alignToRail } from "../../src/processing/rail/alignToRail";
import { railContext, trainNetwork } from "../../src/processing/rail/railNetwork";
import { WayIndex } from "../../src/processing/wayIndex";
import { railCorridor } from "../support/railCorridor";
import { railRide } from "../support/railWorld";
import type { Vertex } from "../support/syntheticWorld";

const config = defaultProcessingConfig.rail;

const kept = (raw: readonly RawPoint[]): KeptPoint[] =>
  raw.map((point, index) => ({
    index,
    t: point.t,
    lat: point.lat,
    lon: point.lon,
    speed: 0,
    accuracy: point.accuracy ?? 30,
    stationary: false,
    reportedSpeed: null,
    altitude: null,
    verticalAccuracy: null,
    motion: [],
  }));

/** CPU milliseconds of the best of two runs, and the last result. */
function measure(map: MapData, points: KeptPoint[]) {
  let result = alignToRail(
    points,
    railContext(new WayIndex(map, LocalProjection.around(points)), trainNetwork),
    config,
  );
  const timings: number[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // The index and graph are built for the piece, not per ride: they sit outside the measure's clock only when the context is reused.
    const context = railContext(new WayIndex(map, LocalProjection.around(points)), trainNetwork);
    const before = process.cpuUsage();
    result = alignToRail(points, context, config);
    const used = process.cpuUsage(before);
    timings.push((used.user + used.system) / 1000);
  }
  return { best: Math.min(...timings), timings, result };
}

describe("rail alignment bounds", () => {
  it("B2: 3 h at 1 Hz over 300 km of corridor, with a road beside it and a six-track station every 10 km", () => {
    const length = 300_000;
    const map = railCorridor(length, 10_000);
    const path: Vertex[] = [
      [0, 0],
      [length, 0],
    ];
    const raw = railRide(path, {
      intervalS: 1,
      noiseM: 6,
      accuracy: 10,
      speedMs: length / 10_800,
      seed: 21,
    });
    expect(raw.length).toBeGreaterThan(10_000);
    const { best, timings, result } = measure(map, kept(raw));
    process.stdout.write(
      `rail align B2: ${raw.length} points, ${result.stats.steps} steps, ${result.stats.searches} searches, ${result.stats.settledNodes} nodes settled in ${best.toFixed(0)} ms CPU (${timings.map((ms) => ms.toFixed(0)).join(", ")})\n`,
    );
    expect(result.stats.runs).toBe(1);
    expect(result.stats.settledNodes).toBeLessThan(5_000_000);
    expect(best).toBeLessThan(400);
  }, 60_000);

  it("B3: a 2 h train at one point every 10 minutes, gaps up to 25 km", () => {
    const map = railCorridor(150_000, 10_000);
    const raw = railRide(
      [
        [1000, 0],
        [60_000, 0],
      ],
      { intervalS: 600, speedMs: 41, seed: 22 },
    );
    expect(raw.length).toBeGreaterThanOrEqual(3);
    const { best, result } = measure(map, kept(raw));
    process.stdout.write(`rail align B3: ${raw.length} points in ${best.toFixed(1)} ms CPU\n`);
    expect(result.stats.runs).toBe(1);
    expect(result.points.every((point) => point.routed || point.legM === 0)).toBe(true);
    // Every search stays within the 80 km and 400 hops of the config: the stats say what the largest
    // was given (this ride's gaps are 25 km, so a search did reach out that far).
    process.stdout.write(
      `rail align B3: largest search bound ${Math.round(result.stats.maxSearchBoundM)} m, ${result.stats.maxSearchHops} hops, ${result.stats.searches} searches\n`,
    );
    expect(result.stats.maxSearchBoundM).toBeGreaterThan(20_000);
    expect(result.stats.maxSearchBoundM).toBeLessThanOrEqual(config.maxRouteM);
    expect(result.stats.maxSearchHops).toBe(config.maxHops);
    expect(best).toBeLessThan(50);
  });
});
