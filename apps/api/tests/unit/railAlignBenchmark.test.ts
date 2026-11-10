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
import { toXY, type Vertex } from "../support/syntheticWorld";

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
    // The ride's largest gap must have been given the bound the formula gives it: the search reached
    // out that far (a skipped step's search may have been given more, up to `maxRouteM`).
    const points = kept(raw);
    const gapM = Math.max(
      ...points.slice(1).map((point, index) => {
        const [x, y] = toXY(point);
        const [x0, y0] = toXY(points[index] ?? point);
        return Math.hypot(x - x0, y - y0);
      }),
    );
    const gapS = Math.max(
      ...points.slice(1).map((point, index) => point.t - (points[index]?.t ?? 0)),
    );
    const gapBoundM = Math.min(
      config.maxRouteM,
      config.routeFactor * gapM + config.routeSlackM,
      config.maxSpeedMs * gapS + config.routeSlackM,
    );
    process.stdout.write(
      `rail align B3: largest search bound ${Math.round(result.stats.maxSearchBoundM)} m (the largest gap's: ${Math.round(gapBoundM)} m), ${result.stats.searches} searches\n`,
    );
    expect(gapBoundM).toBeGreaterThan(20_000);
    expect(result.stats.maxSearchBoundM).toBeGreaterThanOrEqual(gapBoundM - 1);
    expect(best).toBeLessThan(50);
  });

  it("the outlier state adds at most twice the searches and settled nodes on rides without jumps", () => {
    // `maxOutlierSteps: 0` is the outlier cost at infinity: no step is ever skipped.
    const without = { ...config, maxOutlierSteps: 0 };
    const rides: [string, MapData, RawPoint[]][] = [
      [
        "dense, 5 s",
        railCorridor(60_000, 10_000),
        railRide(
          [
            [0, 0],
            [50_000, 0],
          ],
          { intervalS: 5, noiseM: 6, accuracy: 10, speedMs: 40, seed: 31 },
        ),
      ],
      [
        "sparse, 10 min",
        railCorridor(150_000, 10_000),
        railRide(
          [
            [1000, 0],
            [60_000, 0],
          ],
          { intervalS: 600, speedMs: 41, seed: 22 },
        ),
      ],
    ];
    for (const [name, map, raw] of rides) {
      const points = kept(raw);
      const run = (rail: typeof config) =>
        alignToRail(
          points,
          railContext(new WayIndex(map, LocalProjection.around(points)), trainNetwork),
          rail,
        );
      const [off, on] = [run(without), run(config)];
      process.stdout.write(
        `rail align outlier state, ${name}: searches ${off.stats.searches} -> ${on.stats.searches} (${on.stats.skipSearches} for skipped steps), settled nodes ${off.stats.settledNodes} -> ${on.stats.settledNodes}\n`,
      );
      expect(off.stats.skipSearches).toBe(0);
      expect(on.stats.searches).toBeLessThanOrEqual(2 * off.stats.searches);
      expect(on.stats.settledNodes).toBeLessThanOrEqual(2 * Math.max(1, off.stats.settledNodes));
      // Nothing is skipped on a clean ride: the same places either way.
      expect(on.points).toEqual(off.points);
    }
  });
});
