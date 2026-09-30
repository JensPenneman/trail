import { z } from "zod";

/** `GET /api/config` — public, unauthenticated runtime configuration for the web app. */
export const publicConfigSchema = z.object({
  appName: z.string(),
  /** Semver of the running build, e.g. `0.1.0`. */
  version: z.string(),
  /** Git commit the image was built from (short SHA) or `dev`. */
  commit: z.string(),
  /** ISO build time, or null in development. */
  builtAt: z.iso.datetime().nullable(),
  /** Canonical origin of the dashboard, e.g. `https://trail.jenspenneman.com`. */
  publicUrl: z.url(),
  /** Full URL devices post to, e.g. `https://trail.jenspenneman.com/api/overland`. */
  ingestUrl: z.url(),
  /** MapLibre style JSON URLs per colour scheme. */
  mapStyles: z.object({ light: z.url(), dark: z.url() }),
  /** Freshness thresholds used by `deviceStatus()`. */
  thresholds: z.object({
    liveMinutes: z.number().int().positive(),
    staleHours: z.number().int().positive(),
  }),
  features: z.object({
    /** True when silent-device alerts (ntfy) are configured on the server. */
    alerts: z.boolean(),
  }),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
