/**
 * The upper bounds of the histogram's buckets in milliseconds: 1, 1.25, 1.5,
 * 2, 2.5, 3, 4, 5, 6 and 8 of every decade from 0.1 ms to 100 s, so a bucket
 * is at most a quarter wider than the one below it. Every request budget is
 * one of them (`requestBudgets.ts`), so the share of requests over a budget
 * is counted exactly, not estimated; a request over 100 s lands in the last
 * bucket, which ends at the slowest request seen.
 */
const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
export const bucketBounds: readonly number[] = [
  ...[-1, 0, 1, 2, 3, 4].flatMap((power) =>
    steps.map((step) => Math.round(step * 10 ** power * 1000) / 1000),
  ),
  100_000,
];

/** The bucket of a duration: the first whose bound is not below it, or the overflow bucket. */
export function bucketOf(ms: number): number {
  let low = 0;
  let high = bucketBounds.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((bucketBounds[middle] ?? Number.POSITIVE_INFINITY) < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Durations of one route in one slice of time: counts per bucket, the slowest
 * one, the 5xx and 304 answers and the bytes sent. Fixed size whatever the
 * traffic (62 counters), so a route's memory is bounded by its slices.
 */
export class LatencyHistogram {
  readonly counts = new Uint32Array(bucketBounds.length + 1);
  count = 0;
  maxMs = 0;
  errors = 0;
  notModified = 0;
  bytes = 0;

  add(ms: number, answer: { status: number; bytes: number }): void {
    const bucket = bucketOf(ms);
    this.counts[bucket] = (this.counts[bucket] ?? 0) + 1;
    this.count += 1;
    if (ms > this.maxMs) this.maxMs = ms;
    if (answer.status >= 500) this.errors += 1;
    if (answer.status === 304) this.notModified += 1;
    this.bytes += answer.bytes;
  }

  merge(other: LatencyHistogram): void {
    for (const [bucket, count] of other.counts.entries()) {
      this.counts[bucket] = (this.counts[bucket] ?? 0) + count;
    }
    this.count += other.count;
    if (other.maxMs > this.maxMs) this.maxMs = other.maxMs;
    this.errors += other.errors;
    this.notModified += other.notModified;
    this.bytes += other.bytes;
  }

  clear(): void {
    this.counts.fill(0);
    this.count = 0;
    this.maxMs = 0;
    this.errors = 0;
    this.notModified = 0;
    this.bytes = 0;
  }

  /**
   * The `q`-quantile by nearest rank, placed within its bucket by linear
   * interpolation and never above the slowest request: within a quarter of
   * the true value, and always in the bucket the true value is in, so a
   * quantile over a budget is reported over it. Null without requests.
   */
  quantile(q: number): number | null {
    if (this.count === 0) return null;
    const rank = Math.max(1, Math.ceil(q * this.count));
    let below = 0;
    for (const [bucket, count] of this.counts.entries()) {
      if (count === 0) continue;
      if (below + count >= rank) {
        const lower = bucket === 0 ? 0 : (bucketBounds[bucket - 1] ?? 0);
        const upper = Math.min(bucketBounds[bucket] ?? this.maxMs, this.maxMs);
        return Math.max(lower, lower + ((upper - lower) * (rank - below)) / count);
      }
      below += count;
    }
    return this.maxMs;
  }

  /** Requests slower than `ms`, exactly when `ms` is a bucket bound. */
  countAbove(ms: number): number {
    let above = 0;
    for (let bucket = bucketOf(ms) + 1; bucket < this.counts.length; bucket += 1) {
      above += this.counts[bucket] ?? 0;
    }
    return above;
  }
}
