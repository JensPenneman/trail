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

/** Whether the phone can have moved from `from` to `to` in the time between the two fixes. */
function reachable(from: DistancePoint, to: DistancePoint): boolean {
  const seconds = to.t - from.t;
  return seconds > 0 && haversineM(from, to) / seconds <= maxSpeedMs;
}

/**
 * Jitter-suppressed track length (docs/architecture.md §8.1). Distance is
 * measured from an anchor point; a step counts only when it exceeds
 * max(15 m, mean accuracy of both points), which keeps a phone lying on a
 * table from "walking" kilometres.
 *
 * A position the phone cannot have reached — faster than 350 m/s — is a glitch
 * and ignored altogether. Speed is judged between neighbouring fixes, never
 * against the anchor, which is hours old while the phone stands still; and a
 * fix is only used once the next one agrees with it, so a far-off glitch that
 * looks plausible after a gap in the data is dropped as soon as the phone
 * reports from where it really is.
 */
export class DistanceAccumulator {
  /** Where counted distance is measured from. */
  #anchor: DistancePoint | null = null;
  /** The last fix known to be real. */
  #confirmed: DistancePoint | null = null;
  /** The newest fix: reachable from `#confirmed`, waiting for the next one to agree. */
  #pending: DistancePoint | null = null;
  #total = 0;

  add(point: DistancePoint): void {
    const pending = this.#pending;
    if (pending === null) {
      this.#pending = point;
      return;
    }
    if (reachable(pending, point)) {
      this.#confirm(pending);
      this.#pending = point;
      return;
    }
    // The two disagree: whichever the last real fix agrees with is real, the other a glitch.
    const confirmed = this.#confirmed;
    if (confirmed === null || reachable(confirmed, point)) this.#pending = point;
  }

  /** The distance so far; the newest fix counts, as nothing contradicts it (yet). */
  get totalM(): number {
    const pending = this.#pending;
    return this.#total + (pending === null ? 0 : this.#stepTo(pending));
  }

  #confirm(point: DistancePoint): void {
    this.#confirmed = point;
    if (this.#anchor === null) {
      this.#anchor = point;
      return;
    }
    const step = this.#stepTo(point);
    if (step > 0) {
      this.#total += step;
      this.#anchor = point;
    }
  }

  /** The distance a fix adds when it is used: from the anchor, if beyond the jitter threshold. */
  #stepTo(point: DistancePoint): number {
    const anchor = this.#anchor;
    if (anchor === null) return 0;
    const step = haversineM(anchor, point);
    const threshold = Math.max(minStepM, ((anchor.accuracy ?? 0) + (point.accuracy ?? 0)) / 2);
    return step > threshold ? step : 0;
  }
}

/** Distance of a time-ordered track, in metres. */
export function trackDistance(points: Iterable<DistancePoint>): number {
  const accumulator = new DistanceAccumulator();
  for (const point of points) accumulator.add(point);
  return accumulator.totalM;
}
