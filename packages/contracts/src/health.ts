import { z } from "zod";

/**
 * Processing as `/api/health` sees it (docs/architecture.md §3, §8): the
 * workers' heartbeats and the queue, counts only — never which worker, host or
 * process.
 */
export const processingHealthSchema = z.object({
  /**
   * `up`: a worker beat within the last 90 s, by the database's clock; `down`:
   * none did; `none`: processing is switched off (`PROCESSING_ENABLED=false`).
   */
  worker: z.enum(["up", "down", "none"]),
  /** Whole seconds since the newest heartbeat, by the database's clock; null without one. */
  lastSeenS: z.number().int().nonnegative().nullable(),
  /** Windows waiting in the processing queue, counted up to 10 000. */
  queued: z.number().int().nonnegative(),
});
export type ProcessingHealth = z.infer<typeof processingHealthSchema>;

/**
 * `GET /api/health/live`: the process only, never the database (the
 * container's health check); `starting` while the server waits for the
 * database and runs the migrations.
 */
export const liveHealthSchema = z.object({
  status: z.enum(["ok", "starting"]),
  version: z.string(),
  commit: z.string(),
  uptimeS: z.number().int().nonnegative(),
});
export type LiveHealth = z.infer<typeof liveHealthSchema>;

/**
 * `GET /api/health` (503 only when the database is down: the API's truth) and
 * `GET /api/health/processing` (503 also when the worker is down, for a
 * monitor of the worker). `processing` is there whenever the database answered.
 */
export const healthSchema = liveHealthSchema.extend({
  status: z.enum(["ok", "unavailable"]),
  db: z.enum(["ok", "down"]),
  processing: processingHealthSchema.optional(),
});
export type Health = z.infer<typeof healthSchema>;

/**
 * One window of a route's requests in `/api/health/requests`: counts and
 * milliseconds only. Quantiles are estimated within a third of the true
 * value; `overBudget` counts the requests slower than the route's budget
 * exactly (0 without a budget). Null quantiles: no request in the window.
 */
export const requestWindowSchema = z.object({
  count: z.number().int().nonnegative(),
  /** Answers with a 5xx status. */
  errors: z.number().int().nonnegative(),
  /** `304 Not Modified`: the browser's copy was current. */
  notModified: z.number().int().nonnegative(),
  /** Requests whose client closed the connection before the answer was out; timed until then. */
  aborted: z.number().int().nonnegative(),
  overBudget: z.number().int().nonnegative(),
  p50Ms: z.number().nonnegative().nullable(),
  p95Ms: z.number().nonnegative().nullable(),
  maxMs: z.number().nonnegative().nullable(),
  /** Bytes of the answers' bodies as sent (compressed when they were), on average. */
  meanBytes: z.number().int().nonnegative().nullable(),
});
export type RequestWindow = z.infer<typeof requestWindowSchema>;

/** A route as the request log names it: its method and pattern, never a path with ids. */
export const requestRouteSchema = z.object({
  method: z.string(),
  route: z.string(),
  /**
   * The route's requests over more than a day, of a route whose budget is for
   * a day (the tracks, the timeline): timed apart from its others, without a
   * budget.
   */
  longRanges: z.boolean(),
  /** The p95 the route may take (docs/architecture.md §8.10); null: none. */
  budgetMs: z.number().int().positive().nullable(),
  /** The last 15 minutes' p95 is over the budget: more than 5 % of them were slower. */
  overBudget: z.boolean(),
  last15m: requestWindowSchema,
  last24h: requestWindowSchema,
});
export type RequestRoute = z.infer<typeof requestRouteSchema>;

/**
 * `GET /api/health/requests`: this API process's own timing of its requests,
 * per route, from memory (no database); `over_budget` when any route's last
 * 15 minutes went over its budget. The counts restart with the process.
 */
export const requestsHealthSchema = liveHealthSchema.extend({
  status: z.enum(["ok", "over_budget"]),
  routes: z.array(requestRouteSchema),
});
export type RequestsHealth = z.infer<typeof requestsHealthSchema>;
