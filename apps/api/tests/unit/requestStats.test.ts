import { describe, expect, it } from "vitest";
import { bucketBounds, bucketOf, LatencyHistogram } from "../../src/requests/latencyHistogram";
import {
  budgetFor,
  defaultGetP95Ms,
  historyDayP95Ms,
  isPerDay,
  requestBudgets,
} from "../../src/requests/requestBudgets";
import { RequestStats } from "../../src/requests/requestStats";

const ok = { status: 200, bytes: 100 };

/** A histogram of these durations. */
const histogramOf = (durations: readonly number[]): LatencyHistogram => {
  const histogram = new LatencyHistogram();
  for (const ms of durations) histogram.add(ms, ok);
  return histogram;
};

/** The exact nearest-rank quantile, for comparison. */
const exact = (durations: readonly number[], q: number): number => {
  const sorted = [...durations].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(q * sorted.length)) - 1] ?? Number.NaN;
};

describe("the latency histogram", () => {
  it("has every budget as a bucket bound, so the share over it is exact", () => {
    for (const ms of [
      ...requestBudgets.map((budget) => budget.p95Ms),
      historyDayP95Ms,
      defaultGetP95Ms,
    ]) {
      expect(bucketBounds).toContain(ms);
    }
    expect(bucketBounds[0]).toBe(0.1);
    expect(bucketBounds.at(-1)).toBe(100_000);
    for (let index = 1; index < bucketBounds.length; index += 1) {
      const ratio = (bucketBounds[index] ?? 0) / (bucketBounds[index - 1] ?? 1);
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThanOrEqual(1.34);
    }
  });

  it("puts a duration in the first bucket whose bound is not below it", () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(0.1)).toBe(0);
    expect(bucketOf(0.11)).toBe(1);
    expect(bucketBounds[bucketOf(100)]).toBe(100);
    expect(bucketBounds[bucketOf(100.01)]).toBe(125);
    expect(bucketOf(250_000)).toBe(bucketBounds.length);
  });

  it("estimates quantiles within a quarter of the true value, never above the slowest", () => {
    // A skewed spread like an API's: most fast, a tail of slow ones.
    let seed = 7;
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    const durations = Array.from(
      { length: 5000 },
      () => 2 + 40 * random() ** 3 + (random() < 0.06 ? 900 * random() : 0),
    );
    const histogram = histogramOf(durations);
    for (const q of [0.5, 0.9, 0.95, 0.99]) {
      const estimate = histogram.quantile(q) ?? 0;
      const truth = exact(durations, q);
      expect(Math.abs(estimate - truth) / truth).toBeLessThanOrEqual(0.25);
    }
    expect(histogram.quantile(1)).toBeLessThanOrEqual(histogram.maxMs);
    expect(histogram.maxMs).toBe(Math.max(...durations));
    expect(new LatencyHistogram().quantile(0.5)).toBeNull();
  });

  it("counts the requests slower than a budget exactly", () => {
    const histogram = histogramOf([99.9, 100, 100.01, 120, 150, 151, 4000]);
    expect(histogram.countAbove(100)).toBe(5);
    expect(histogram.countAbove(150)).toBe(2);
    expect(histogram.countAbove(100_000)).toBe(0);
  });

  it("reports a quantile over a budget whenever more than its share was slower", () => {
    // 94 of 100 within 100 ms: the p95 is the 95th, 120 ms.
    const histogram = histogramOf([
      ...Array.from({ length: 94 }, () => 50),
      ...Array.from({ length: 6 }, () => 120),
    ]);
    expect(histogram.countAbove(100)).toBe(6);
    expect(histogram.quantile(0.95)).toBeGreaterThan(100);
    // 95 of 100 within: the p95 is 50 ms.
    const within = histogramOf([
      ...Array.from({ length: 95 }, () => 50),
      ...Array.from({ length: 5 }, () => 120),
    ]);
    expect(within.quantile(0.95)).toBeLessThanOrEqual(100);
  });

  it("merges and counts errors, 304s and bytes", () => {
    const one = histogramOf([10, 20]);
    const other = new LatencyHistogram();
    other.add(500, { status: 503, bytes: 50 });
    other.add(1, { status: 304, bytes: 0 });
    one.merge(other);
    expect(one).toMatchObject({ count: 4, errors: 1, notModified: 1, bytes: 250, maxMs: 500 });
    one.clear();
    expect(one).toMatchObject({ count: 0, errors: 0, notModified: 0, bytes: 0, maxMs: 0 });
    expect(one.counts.every((count) => count === 0)).toBe(true);
  });
});

describe("the request budgets", () => {
  it("are §3.2's, per route, and every other GET of the API has the loosest", () => {
    expect(budgetFor("GET /api/devices")).toBe(100);
    expect(budgetFor("GET /api/v1/segments")).toBe(200);
    expect(budgetFor("GET /api/v1/tracks")).toBe(400);
    expect(budgetFor("GET /api/heatmap")).toBe(150);
    expect(budgetFor("GET /api/v1/insights/overview")).toBe(1000);
    expect(budgetFor("GET /api/visits")).toBe(defaultGetP95Ms);
    expect(budgetFor("GET /api/v1/people/:userId/track")).toBe(defaultGetP95Ms);
  });

  it("are for a day on the tracks and the timeline: their longer ranges have none", () => {
    for (const route of ["GET /api/tracks", "GET /api/v1/tracks", "GET /api/v1/segments"]) {
      expect(isPerDay(route), route).toBe(true);
      expect(budgetFor(route, true), route).toBeNull();
    }
    // Insights' budget is for a month, the heatmap's for any viewport: never per day.
    expect(isPerDay("GET /api/v1/insights/overview")).toBe(false);
    expect(budgetFor("GET /api/v1/insights/overview", true)).toBe(1000);
    expect(budgetFor("GET /api/stats/days", true)).toBe(defaultGetP95Ms);
  });

  it("leave out streams, exports, uploads, health checks, writes and what matched no route", () => {
    for (const route of [
      "GET /api/events",
      "GET /api/export",
      "GET /api/overland",
      "GET /api/osmand",
      "POST /api/overland",
      "GET /api/health/live",
      "GET /api/health",
      "GET /api/*",
      "GET /api/v1/*",
      "PATCH /api/me",
      "GET /*",
      "GET /assets/*",
    ]) {
      expect(budgetFor(route), route).toBeNull();
    }
  });

  it("name each route once", () => {
    const routes = requestBudgets.map((budget) => budget.route);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(route).toMatch(/^GET \/api\/[a-z0-9/-]+$/);
  });
});

describe("the request summary", () => {
  const start = Date.UTC(2026, 9, 28, 12, 0, 0);

  it("keeps the last 15 minutes and the last 24 hours of each route apart", () => {
    let now = start;
    const stats = new RequestStats({ now: () => now });
    stats.record("GET /api/devices", 30, ok);
    now += 20 * 60_000;
    stats.record("GET /api/devices", 50, ok);
    stats.record("GET /api/devices", 70, { status: 500, bytes: 10 });
    stats.record("GET /api/devices", 20, { status: 304, bytes: 0 });
    const [devices] = stats.summary();
    expect(devices).toMatchObject({
      method: "GET",
      route: "/api/devices",
      budgetMs: 100,
      overBudget: false,
      last15m: { count: 3, errors: 1, notModified: 1, overBudget: 0, maxMs: 70, meanBytes: 37 },
      last24h: { count: 4, errors: 1, notModified: 1, maxMs: 70 },
    });
    now += 24 * 3_600_000;
    expect(stats.summary()).toEqual([]);
  });

  it("marks a route whose last 15 minutes went over its budget, and only those minutes", () => {
    let now = start;
    const stats = new RequestStats({ now: () => now });
    for (let index = 0; index < 18; index += 1) stats.record("GET /api/heatmap", 40, ok);
    stats.record("GET /api/heatmap", 160, ok);
    stats.record("GET /api/heatmap", 900, ok);
    stats.record("GET /api/stats/activity", 5000, ok);
    stats.record("POST /api/overland", 5000, ok);
    const [first, ...others] = stats.summary();
    expect(first).toMatchObject({
      route: "/api/heatmap",
      overBudget: true,
      last15m: { count: 20, overBudget: 2, maxMs: 900 },
    });
    expect(first?.last15m.p95Ms).toBeGreaterThan(150);
    // Over budget first; an upload has no budget here (§3.1 sets them by batch size).
    expect(others.map(({ method, route, overBudget }) => [method, route, overBudget])).toEqual([
      ["GET", "/api/stats/activity", true],
      ["POST", "/api/overland", false],
    ]);
    // A quarter of an hour later the slow minute is out of the recent window, still in the day.
    now += 15 * 60_000;
    stats.record("GET /api/heatmap", 40, ok);
    const heatmap = stats.summary().find((route) => route.route === "/api/heatmap");
    expect(heatmap).toMatchObject({
      overBudget: false,
      last15m: { count: 1 },
      last24h: { count: 21, overBudget: 2 },
    });
  });

  it("times a per-day route's longer ranges apart, never over a budget", () => {
    const stats = new RequestStats({ now: () => start });
    stats.record("GET /api/v1/tracks", 120, ok);
    stats.record("GET /api/v1/tracks", 4000, ok, true);
    stats.record("GET /api/v1/tracks", 9000, ok, true);
    expect(stats.summary()).toMatchObject([
      { route: "/api/v1/tracks", longRanges: false, budgetMs: 400, overBudget: false },
      {
        route: "/api/v1/tracks",
        longRanges: true,
        budgetMs: null,
        overBudget: false,
        last15m: { count: 2, overBudget: 0, maxMs: 9000 },
      },
    ]);
  });

  it("reuses a slice once its time has passed, however long it runs", () => {
    let now = start;
    const stats = new RequestStats({ now: () => now });
    for (let minute = 0; minute < 3 * 24 * 60; minute += 1) {
      stats.record("GET /api/devices", 10, ok);
      now += 60_000;
    }
    const [devices] = stats.summary();
    // The 15 minutes before now, the current one empty yet; 96 quarters, the current one too.
    expect(devices?.last15m.count).toBe(14);
    expect(devices?.last24h.count).toBe(95 * 15);
  });
});
