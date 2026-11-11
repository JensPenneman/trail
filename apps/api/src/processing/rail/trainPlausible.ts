import { haversineM } from "../../tracks/haversine";
import type { KeptPoint } from "../keptPoint";
import type { RailConfig } from "../processingConfig";

/** The shortest time a speed is measured over, seconds. */
const speedBaselineS = 20;

/**
 * How far a move travelled at or above `minTrainSpeedMs`, chord by chord
 * between its kept points (at least `speedBaselineS` apart), metres. Judged by distance, not by the number of
 * points: a ride whose points mostly lie in stations, or a short hop after a
 * long walk in one move, still adds up to the length of its fast stretches,
 * while a walk, a bike or a bus in town never reaches it.
 */
export function trainLikeM(points: readonly KeptPoint[], config: RailConfig): number {
  let fastM = 0;
  let from = 0;
  while (from < points.length - 1) {
    const start = points[from];
    // The speed is taken over at least `speedBaselineS`: at 1 Hz the noise of two fixes alone makes a walk look fast.
    let to = from + 1;
    while (to < points.length - 1 && (points[to]?.t ?? 0) - (start?.t ?? 0) < speedBaselineS) {
      to += 1;
    }
    const end = points[to];
    if (start === undefined || end === undefined) break;
    const chordM = haversineM(start, end);
    if (chordM / Math.max(1, end.t - start.t) >= config.minTrainSpeedMs) {
      fastM += chordM;
      from = to;
    } else {
      from += 1;
    }
  }
  return fastM;
}

/**
 * Whether a move could be a train at all, before any rail data is read or any
 * alignment runs (docs/architecture.md §17.3): it travelled at least `minRunM`
 * at or above `minTrainSpeedMs` (`trainLikeM`), or a person set its mode to
 * train (`userTrain`), which always passes. A move that fails is not aligned;
 * a segment of it that ends up a train is written `skipped/not_train`, so it
 * shows in the counts, and a later correction to train judges it.
 */
export function couldBeTrain(
  points: readonly KeptPoint[],
  config: RailConfig,
  userTrain = false,
): boolean {
  if (points.length < 2) return false;
  return userTrain || trainLikeM(points, config) >= config.minRunM;
}
