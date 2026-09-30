import { haversineM } from "./haversine";

export interface DistancePoint {
  lat: number;
  lon: number;
  /** Epoch seconds. */
  t: number;
  /** Horizontal accuracy in metres, or null when unknown. */
  accuracy: number | null;
}

/** GPS noise while standing still is below this, so shorter steps never count. */
const minStepM = 15;
/** Faster than any airliner: such a step is a position glitch. */
const maxSpeedMs = 350;

/**
 * Jitter-suppressed track length (docs/architecture.md §8.1). Distance is
 * measured from an anchor point; a step counts only when it exceeds
 * max(15 m, mean accuracy of both points), which keeps a phone lying on a
 * table from "walking" kilometres, and steps implying > 350 m/s are skipped.
 */
export class DistanceAccumulator {
  #anchor: DistancePoint | null = null;
  #total = 0;

  add(point: DistancePoint): void {
    const anchor = this.#anchor;
    if (anchor === null) {
      this.#anchor = point;
      return;
    }
    const step = haversineM(anchor, point);
    const threshold = Math.max(minStepM, ((anchor.accuracy ?? 0) + (point.accuracy ?? 0)) / 2);
    if (step <= threshold) return;
    const seconds = point.t - anchor.t;
    if (seconds <= 0 || step / seconds > maxSpeedMs) return;
    this.#total += step;
    this.#anchor = point;
  }

  get totalM(): number {
    return this.#total;
  }
}

/** Distance of a time-ordered track, in metres. */
export function trackDistance(points: Iterable<DistancePoint>): number {
  const accumulator = new DistanceAccumulator();
  for (const point of points) accumulator.add(point);
  return accumulator.totalM;
}
