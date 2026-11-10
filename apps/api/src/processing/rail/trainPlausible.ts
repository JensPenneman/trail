import { haversineM } from "../../tracks/haversine";
import type { KeptPoint } from "../keptPoint";
import type { RailConfig } from "../processingConfig";

/**
 * Whether a move could be a train at all, before any rail data is read or
 * any alignment runs (docs/architecture.md §17.3): a move shorter than
 * `minRunM` along its chords cannot hold a run and one whose p90 kept speed
 * stays under `minTrainSpeedMs` (a walk, a bike, a bus in town) is no train.
 * Such a move is not aligned and gets no verdict; a later correction to train
 * leaves it as recorded.
 */
export function couldBeTrain(points: readonly KeptPoint[], config: RailConfig): boolean {
  if (points.length < 2) return false;
  let lengthM = 0;
  for (let k = 1; k < points.length; k += 1) {
    const before = points[k - 1];
    const point = points[k];
    if (before !== undefined && point !== undefined) lengthM += haversineM(before, point);
  }
  if (lengthM < config.minRunM) return false;
  const speeds = points.map((point) => point.speed).sort((a, b) => a - b);
  const p90 = speeds[Math.min(speeds.length - 1, Math.floor(0.9 * speeds.length))] ?? 0;
  return p90 >= config.minTrainSpeedMs;
}
