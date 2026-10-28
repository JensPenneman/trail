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

/** `GET /api/health/live`: the process only, never the database (the container's health check). */
export const liveHealthSchema = z.object({
  status: z.literal("ok"),
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
