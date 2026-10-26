import type { AveragedPoint, RawPoint } from "./pipelineTypes";

/** A point that survived averaging, with what the later stages need of its raw reading. */
export interface KeptPoint {
  /** Index in the window's raw points. */
  index: number;
  t: number;
  /** Averaged position. */
  lat: number;
  lon: number;
  speed: number;
  accuracy: number;
  stationary: boolean;
  /** Reported speed, when the phone gave one. */
  reportedSpeed: number | null;
  altitude: number | null;
  verticalAccuracy: number | null;
  motion: readonly string[];
}

/** The kept points of a window, oldest first. */
export function keptPoints(
  raw: readonly RawPoint[],
  averaged: readonly AveragedPoint[],
): KeptPoint[] {
  const kept: KeptPoint[] = [];
  for (const [index, point] of averaged.entries()) {
    const reading = raw[index];
    if (!point.kept || reading === undefined) continue;
    kept.push({
      index,
      t: point.t,
      lat: point.lat,
      lon: point.lon,
      speed: point.speed,
      accuracy: point.accuracy,
      stationary: point.stationary,
      reportedSpeed: reading.speed,
      altitude: reading.altitude,
      verticalAccuracy: reading.verticalAccuracy,
      motion: reading.motion,
    });
  }
  return kept;
}
