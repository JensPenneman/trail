import { z } from "zod";

/**
 * Satellite imagery, when the server has it (`MAP_STYLE_SATELLITE`): a whole
 * MapLibre style, or one raster tile layer the web app turns into a style.
 */
export const satelliteStyleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("style"), url: z.url() }),
  z.object({
    kind: z.literal("raster"),
    /** XYZ tile URL template with `{z}`, `{x}` and `{y}`. */
    tiles: z.string().regex(/^https?:\/\//),
    /** Plain text the provider asks to be shown on the map. */
    attribution: z.string().min(1),
  }),
]);
export type SatelliteStyle = z.infer<typeof satelliteStyleSchema>;

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
  /** Overland's receiver endpoint, e.g. `https://trail.jenspenneman.com/api/overland`. */
  ingestUrl: z.url(),
  /** Every ingest endpoint, per protocol (docs/architecture.md §6). */
  ingestUrls: z.object({ overland: z.url(), owntracks: z.url(), osmand: z.url() }),
  /** MapLibre style JSON URLs per colour scheme, and satellite imagery when configured. */
  mapStyles: z.object({
    light: z.url(),
    dark: z.url(),
    satellite: satelliteStyleSchema.optional(),
  }),
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
