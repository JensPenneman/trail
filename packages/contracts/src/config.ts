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

/** A style's address: a URL, or a path on this server (the self-hosted basemap's). */
const mapStyleUrlSchema = z.union([z.url(), z.string().regex(/^\/map\/styles\/[a-z]+\.json$/)]);

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
  /**
   * MapLibre style JSON per colour scheme — a path on this server (`/map/styles/…`)
   * or another server's URL — and satellite imagery when configured.
   */
  mapStyles: z.object({
    light: mapStyleUrlSchema,
    dark: mapStyleUrlSchema,
    satellite: satelliteStyleSchema.optional(),
    /**
     * What the light and dark styles draw (docs/architecture.md §14): `self`,
     * the server's own basemap; `external`, another server's styles; `none`, a
     * plain ground while the server has no basemap yet (the map says so).
     */
    basemap: z.enum(["self", "external", "none"]),
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
