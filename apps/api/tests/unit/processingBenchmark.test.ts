import { expect, it } from "vitest";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { finishWindow, planWindow } from "../../src/processing/runPipeline";
import { denseDay } from "../support/journeys";
import { worldMap } from "../support/syntheticWorld";

/** The budget of docs/architecture.md §17.4: a dense day, map data at hand, well under a few seconds. */
const budgetMs = 3000;

it("processes a dense day of about 20 000 points within the CPU budget", () => {
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
