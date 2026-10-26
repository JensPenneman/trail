import type {
  ManualTrip,
  OverrideSpan,
  RawPoint,
  VisitSpan,
} from "../../src/processing/pipelineTypes";
import {
  defaultProcessingConfig,
  type ProcessingConfig,
} from "../../src/processing/processingConfig";
import { finishWindow, planWindow, type WindowResult } from "../../src/processing/runPipeline";
import { worldMap } from "./syntheticWorld";

/** Runs the whole pipeline over points in the synthetic world, every tile available. */
export function processWorld(
  points: readonly RawPoint[],
  options: {
    visits?: readonly VisitSpan[];
    trips?: readonly ManualTrip[];
    overrides?: readonly OverrideSpan[];
    /** False: no map data at all (mapping switched off). */
    withMap?: boolean;
    config?: ProcessingConfig;
  } = {},
): WindowResult {
  const config = options.config ?? defaultProcessingConfig;
  const plan = planWindow(points, options.visits ?? [], config);
  const withMap = options.withMap ?? true;
  return finishWindow(
    plan,
    {
      trips: options.trips ?? [],
      overrides: options.overrides ?? [],
      map: withMap ? worldMap() : null,
      available: withMap ? plan.tiles : new Set(),
    },
    config,
  );
}

export const moves = (result: WindowResult) =>
  result.segments.filter((segment) => segment.kind === "move");
export const stops = (result: WindowResult) =>
  result.segments.filter((segment) => segment.kind === "stop");
