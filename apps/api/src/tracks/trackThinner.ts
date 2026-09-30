import type { TrackPoint } from "@trail/contracts/track";
import { trackGapSeconds } from "@trail/contracts/trackSegments";

/*
 * The spacing is capped well below the segment gap: two kept neighbours are
 * then never further apart than the gap unless the phone really stopped
 * logging, so thinning cannot invent segment breaks.
 */
const maxStrideSeconds = trackGapSeconds / 2;

/**
 * Bounds memory for very long, dense ranges (93 days at 1 Hz is 8 million
 * points): when more than `limit` points are held, the minimum spacing between
 * kept points doubles and the held points are thinned again. The first and
 * last point of every segment always stay. Below the limit nothing is dropped.
 */
export class TrackThinner {
  readonly #limit: number;
  #kept: TrackPoint[] = [];
  #stride = 0;
  #lastKeptTime = Number.NEGATIVE_INFINITY;
  #previous: TrackPoint | null = null;
  #previousKept = false;

  constructor(limit: number) {
    this.#limit = limit;
  }

  add(point: TrackPoint): void {
    const time = point[2];
    const previous = this.#previous;
    const startsSegment = previous === null || time - previous[2] > trackGapSeconds;
    if (startsSegment && previous !== null && !this.#previousKept) {
      this.#kept.push(previous); // the last point before the gap ends its segment
    }
    const keep = startsSegment || time - this.#lastKeptTime >= this.#stride;
    if (keep) {
      this.#kept.push(point);
      this.#lastKeptTime = time;
    }
    this.#previous = point;
    this.#previousKept = keep;
    if (this.#kept.length >= this.#limit && this.#stride < maxStrideSeconds) this.#thin();
  }

  /** The kept points, oldest first (the very last point always included). */
  finish(): TrackPoint[] {
    if (this.#previous !== null && !this.#previousKept) this.#kept.push(this.#previous);
    this.#previousKept = true;
    return this.#kept;
  }

  #thin(): void {
    this.#stride = Math.min(maxStrideSeconds, this.#stride === 0 ? 2 : this.#stride * 2);
    const thinned: TrackPoint[] = [];
    let lastKept = Number.NEGATIVE_INFINITY;
    for (const [index, point] of this.#kept.entries()) {
      const before = this.#kept[index - 1];
      const after = this.#kept[index + 1];
      const time = point[2];
      const segmentStart = before === undefined || time - before[2] > trackGapSeconds;
      const segmentEnd = after === undefined || after[2] - time > trackGapSeconds;
      if (segmentStart || segmentEnd || time - lastKept >= this.#stride) {
        thinned.push(point);
        lastKept = time;
      }
    }
    this.#kept = thinned;
    this.#lastKeptTime = thinned.at(-1)?.[2] ?? Number.NEGATIVE_INFINITY;
  }
}
