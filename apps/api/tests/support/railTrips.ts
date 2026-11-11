import type { RawPoint } from "../../src/processing/pipelineTypes";
import { concat, lastT, stay, travel, type Vertex } from "./syntheticWorld";

/** Seconds a phone lies at each end of a trip, before and after the ride. */
export const dwellS = 1400;

export interface RailTripOptions {
  /** Epoch seconds of the ride's first point. */
  startT: number;
  intervalS: number;
  speedMs?: number;
  noiseM?: number;
  accuracy?: number;
  /** CoreMotion activities of the ride's points. */
  motion?: readonly string[];
  /** Seconds the phone lies still before and after the ride (1400 by default). */
  dwellS?: number;
  /** The fix's own altitude, so that `values=altitude` has something to give. */
  altitude?: number;
  seed?: number;
}

/**
 * A synthetic trip: the phone lies still at the start, rides `path` and lies
 * still at its end — what the inference needs to see a stop, a move and a
 * stop. Nothing here is a real place or a real ride.
 */
export function railTrip(path: readonly Vertex[], options: RailTripOptions): RawPoint[] {
  const first = path[0];
  const last = path.at(-1);
  if (first === undefined || last === undefined) throw new Error("a trip needs a path");
  const seed = options.seed ?? 1;
  const dwell = options.dwellS ?? dwellS;
  const ride = travel(path, {
    startT: options.startT,
    speedMs: options.speedMs ?? 30,
    intervalS: options.intervalS,
    noiseM: options.noiseM ?? 0,
    accuracy: options.accuracy ?? 5,
    reportSpeed: false,
    ...(options.motion === undefined ? {} : { motion: options.motion }),
    ...(options.altitude === undefined ? {} : { altitude: options.altitude }),
    seed,
  });
  return concat(
    stay(first, {
      startT: options.startT - dwell - 100,
      durationS: dwell,
      intervalS: 20,
      seed: seed + 100,
    }),
    ride,
    stay(last, { startT: lastT(ride) + 20, durationS: dwell, intervalS: 20, seed: seed + 200 }),
  );
}
