import { expect, it } from "vitest";
import { averagePoints } from "../../src/processing/averagePoints";
import { detectStops } from "../../src/processing/detectStops";
import { keptPoints } from "../../src/processing/keptPoint";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { finishWindow, planWindow } from "../../src/processing/runPipeline";
import { denseDay, morning } from "../support/journeys";
import { stay, worldMap } from "../support/syntheticWorld";

/** The budget of docs/architecture.md §17.4: a dense day, map data at hand, well under a few seconds. */
const budgetMs = 3000;

it("processes a dense day of about 20 000 points within the CPU budget", {
  timeout: 60_000,
}, () => {
  const points = denseDay();
  expect(points.length).toBeGreaterThan(20_000);
  const map = worldMap();
  const run = () => {
    const plan = planWindow(points, [], defaultProcessingConfig);
    return finishWindow(
      plan,
      { trips: [], overrides: [], map, available: plan.tiles },
      defaultProcessingConfig,
    );
  };
  run(); // the first run compiles the code paths
  const timings: number[] = [];
  let result = run();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = process.cpuUsage();
    result = run();
    const used = process.cpuUsage(before);
    timings.push((used.user + used.system) / 1000);
  }
  const best = Math.min(...timings);
  process.stdout.write(
    `processing benchmark: ${points.length} points in ${best.toFixed(0)} ms CPU (best of 2: ${timings.map((ms) => ms.toFixed(0)).join(", ")} ms)\n`,
  );
  expect(best).toBeLessThan(budgetMs);
  expect(result.segments.map((segment) => segment.modeInferred ?? segment.kind)).toEqual([
    "stop",
    "walking",
    "train",
    "walking",
    "stop",
    "walking",
    "train",
    "walking",
  ]);
});

it("cuts two days indoors, the fix jumping 70 m every four minutes, in linear time", () => {
  // Every jump ends a dwell, and the dwells are joined into one stay: a join must not look at
  // the whole stay again.
  const points: RawPoint[] = [];
  for (let block = 0; block < 720; block += 1) {
    const x = block % 2 === 0 ? 0 : 70;
    points.push(
      ...stay([x, -2000], {
        startT: morning + block * 240,
        durationS: 239,
        intervalS: 1,
        noiseM: 2,
        motion: [],
        seed: block,
      }),
    );
  }
  const kept = keptPoints(points, averagePoints(points, defaultProcessingConfig.averaging));
  const before = process.cpuUsage();
  const spans = detectStops(kept, [], defaultProcessingConfig.stops);
  const used = process.cpuUsage(before);
  const ms = (used.user + used.system) / 1000;
  process.stdout.write(`two drifting days: ${kept.length} points cut in ${ms.toFixed(0)} ms CPU\n`);
  expect(spans.map((span) => span.kind)).toEqual(["stop"]);
  expect(ms).toBeLessThan(budgetMs);
}, 60_000);
