import type { RequestRoute, RequestWindow } from "@trail/contracts/health";
import { LatencyHistogram } from "./latencyHistogram";
import { budgetFor } from "./requestBudgets";

/* The last 15 minutes in slices of a minute, the last 24 hours in slices of
 * a quarter of an hour: a window is its slices up to now, the one in
 * progress included. */
const recent = { slices: 15, widthMs: 60_000 };
const day = { slices: 96, widthMs: 900_000 };

/** A p95 over budget means more than this share of the requests were slower. */
const overBudgetShare = 0.05;

/** Fixed slices of time, each a histogram, reused once its time has passed. */
class SliceRing {
  readonly size: number;
  readonly widthMs: number;
  readonly #ids: number[];
  readonly #slices: (LatencyHistogram | undefined)[];

  constructor(size: number, widthMs: number) {
    this.size = size;
    this.widthMs = widthMs;
    this.#ids = new Array<number>(size).fill(-1);
    this.#slices = new Array<LatencyHistogram | undefined>(size).fill(undefined);
  }

  add(now: number, ms: number, answer: { status: number; bytes: number }): void {
    const id = Math.floor(now / this.widthMs);
    const at = id % this.size;
    let slice = this.#slices[at];
    if (slice === undefined) {
      slice = new LatencyHistogram();
      this.#slices[at] = slice;
    } else if (this.#ids[at] !== id) {
      slice.clear();
    }
    this.#ids[at] = id;
    slice.add(ms, answer);
  }

  /** The slices of the window that ends now, merged. */
  window(now: number): LatencyHistogram {
    const current = Math.floor(now / this.widthMs);
    const merged = new LatencyHistogram();
    for (const [at, slice] of this.#slices.entries()) {
      const id = this.#ids[at] ?? -1;
      if (slice !== undefined && id > current - this.size && id <= current) merged.merge(slice);
    }
    return merged;
  }
}

const tenth = (ms: number | null): number | null => (ms === null ? null : Math.round(ms * 10) / 10);

function describe(histogram: LatencyHistogram, budgetMs: number | null): RequestWindow {
  return {
    count: histogram.count,
    errors: histogram.errors,
    notModified: histogram.notModified,
    overBudget: budgetMs === null ? 0 : histogram.countAbove(budgetMs),
    p50Ms: tenth(histogram.quantile(0.5)),
    p95Ms: tenth(histogram.quantile(0.95)),
    maxMs: histogram.count === 0 ? null : tenth(histogram.maxMs),
    meanBytes: histogram.count === 0 ? null : Math.round(histogram.bytes / histogram.count),
  };
}

/**
 * The API's own record of how long its requests take, per route
 * (`METHOD /pattern`), for `/api/health/requests` (docs/architecture.md
 * §8.10): in memory, a histogram per route and slice of time, so recording
 * costs a few counters and a route's memory is bounded however busy it is.
 * Numbers only: no path, id, account or query reaches it.
 */
export class RequestStats {
  readonly #routes = new Map<
    string,
    { route: string; longRanges: boolean; recent: SliceRing; day: SliceRing }
  >();
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  /**
   * Counts a request of `route` (`METHOD /pattern`); `longRange`: one over more
   * than a day of a route whose budget is for a day, kept apart.
   */
  record(
    route: string,
    ms: number,
    answer: { status: number; bytes: number },
    longRange = false,
  ): void {
    const key = longRange ? `${route} +` : route;
    let series = this.#routes.get(key);
    if (series === undefined) {
      series = {
        route,
        longRanges: longRange,
        recent: new SliceRing(recent.slices, recent.widthMs),
        day: new SliceRing(day.slices, day.widthMs),
      };
      this.#routes.set(key, series);
    }
    const now = this.#now();
    series.recent.add(now, ms, answer);
    series.day.add(now, ms, answer);
  }

  /** Every route answered in the last 24 hours: those over budget first, then by route. */
  summary(): RequestRoute[] {
    const now = this.#now();
    const routes: RequestRoute[] = [];
    for (const series of this.#routes.values()) {
      const last24h = series.day.window(now);
      if (last24h.count === 0) continue;
      const budgetMs = budgetFor(series.route, series.longRanges);
      const last15m = describe(series.recent.window(now), budgetMs);
      const separator = series.route.indexOf(" ");
      routes.push({
        method: series.route.slice(0, separator),
        route: series.route.slice(separator + 1),
        longRanges: series.longRanges,
        budgetMs,
        overBudget: last15m.count > 0 && last15m.overBudget > last15m.count * overBudgetShare,
        last15m,
        last24h: describe(last24h, budgetMs),
      });
    }
    return routes.sort(
      (a, b) =>
        Number(b.overBudget) - Number(a.overBudget) ||
        a.route.localeCompare(b.route) ||
        a.method.localeCompare(b.method) ||
        Number(a.longRanges) - Number(b.longRanges),
    );
  }
}
