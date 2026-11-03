/**
 * The request budgets (docs/architecture.md §8.10): the p95 each route of the
 * dashboard may take, server-side, from the dashboard targets of
 * docs/design/capacity.md §3.2. `/api/health/requests` marks a route whose
 * last 15 minutes went over its budget; the load harness gates the same
 * numbers (tools/load/lib/targets.js names these routes, and its test keeps
 * both tables equal). No imports: the harness reads this file as it is.
 */
export interface RequestBudget {
  /** `METHOD /route/pattern`, as the request log and `/api/health/requests` name it. */
  route: string;
  p95Ms: number;
  /** The row of §3.2 the budget comes from. */
  target: string;
  /**
   * §3.2's target is for a day: a request over a longer range (`from` and `to`
   * more than a day apart) reads that many days' points, and is timed apart,
   * without a budget.
   */
  perDay?: true;
}

export const requestBudgets: readonly RequestBudget[] = [
  { route: "GET /api/auth/session", p95Ms: 100, target: "session" },
  { route: "GET /api/config", p95Ms: 100, target: "devices, people, shares, session" },
  { route: "GET /api/devices", p95Ms: 100, target: "devices" },
  { route: "GET /api/v1/people", p95Ms: 100, target: "people" },
  { route: "GET /api/v1/shares", p95Ms: 100, target: "shares" },
  { route: "GET /api/v1/shares/incoming", p95Ms: 100, target: "shares" },
  { route: "GET /api/v1/segments", p95Ms: 200, target: "timeline, a day", perDay: true },
  {
    route: "GET /api/tracks",
    p95Ms: 400,
    target: "today's tracks, one device, 1 Hz",
    perDay: true,
  },
  {
    route: "GET /api/v1/tracks",
    p95Ms: 400,
    target: "today's tracks, one device, 1 Hz",
    perDay: true,
  },
  { route: "GET /api/heatmap", p95Ms: 150, target: "heatmap viewport" },
  { route: "GET /api/v1/insights/overview", p95Ms: 1000, target: "Insights, a month" },
];

/**
 * A past day of History (§3.2: p95 ≤ 800 ms warm, ≤ 3 s cold) is served by the
 * tracks routes above, whose budget is today's: the load harness gates the
 * past day on its own (`history_day`), here it counts against today's 400 ms.
 */
export const historyDayP95Ms = 800;

/**
 * Every other GET of the dashboard's API (`/api`, `/api/v1`): the loosest of
 * §3.2's targets, so no request goes without a budget. Not the event stream,
 * the export (a throughput target), the uploads (§3.1 sets theirs by batch
 * size, gated on `ingest_log`), the health checks or anything outside `/api`.
 */
export const defaultGetP95Ms = 1000;

const unbudgeted = [
  /^GET \/api\/events$/,
  /^GET \/api\/export$/,
  /^GET \/api\/(overland|osmand)$/,
  /^GET \/api\/health(\/|$)/,
  /^GET \/api\/(v1\/)?\*$/,
];

const byRoute = new Map(requestBudgets.map((budget) => [budget.route, budget]));

/** Whether a route's budget is for a day, so that its longer ranges are timed apart. */
export function isPerDay(route: string): boolean {
  return byRoute.get(route)?.perDay === true;
}

/**
 * The p95 budget of a route in ms, or null when it has none — nor do the
 * longer ranges of a route whose budget is for a day.
 */
export function budgetFor(route: string, longRange = false): number | null {
  const listed = byRoute.get(route);
  if (listed !== undefined) return longRange && listed.perDay === true ? null : listed.p95Ms;
  if (!route.startsWith("GET /api/")) return null;
  return unbudgeted.some((pattern) => pattern.test(route)) ? null : defaultGetP95Ms;
}
