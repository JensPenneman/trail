import type { SatelliteStyle } from "@trail/contracts/config";
import type { IngestProtocol } from "@trail/contracts/deviceApp";

/** Express `trust proxy` value: hop count, boolean, or a list of addresses/subnet names. */
export type TrustProxySetting = boolean | number | string;

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

interface RateLimitConfig {
  /** Auth ceremonies and link lookups, per IP. */
  authPerMinute: number;
  /** Every other API request (dashboard and v1), per IP. */
  apiPerMinute: number;
  /** Accepted Overland uploads, per device token. */
  ingestPerMinute: number;
  /** Accepted uploads of the one-point-per-request endpoints (OwnTracks, the OsmAnd format), per device token. */
  ingestSinglePerMinute: number;
  /** Uploads with an unknown token, per IP. */
  ingestFailedPer10Minutes: number;
  /** v1 requests with a valid API token, per token. */
  tokenPerMinute: number;
  /** v1 requests with an invalid API token, per IP. */
  tokenFailedPer10Minutes: number;
  /** Requests of the public share endpoint (`/api/public/share`), per IP. */
  publicSharePerMinute: number;
}

export interface AlertConfig {
  /** ntfy topic URL. */
  url: string;
  token: string | null;
}

interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string | null;
}

/** Location processing (docs/architecture.md §17.7). */
interface ProcessingSettings {
  enabled: boolean;
  /** Overpass interpreter for map data; null when mapping is switched off. */
  overpassUrl: string | null;
  /** Download budget per UTC day. */
  overpassDailyBytes: number;
  /** Map tiles are fetched again after this many days. */
  osmTtlDays: number;
  maxAccuracyM: number;
  stopMinS: number;
}

/** Validated runtime configuration (docs/architecture.md §4). */
export interface Config {
  nodeEnv: string;
  isProduction: boolean;
  databaseUrl: string;
  port: number;
  host: string;
  /** Canonical origin without a trailing slash, e.g. `https://trail.example.com`. */
  publicUrl: string;
  /** `publicUrl` followed by `ADDITIONAL_ORIGINS`: where the dashboard and passkeys may be used. */
  allowedOrigins: readonly string[];
  /**
   * The origins whose pages may call `/mcp`: `allowedOrigins` and
   * `MCP_ALLOWED_ORIGINS`. Requests without an `Origin` header (clients that
   * are not browsers) are not limited by it.
   */
  mcpAllowedOrigins: readonly string[];
  /** Full Overland receiver endpoint shown to phones. */
  ingestUrl: string;
  /** Every ingest endpoint shown to phones (`INGEST_BASE_URL` + the protocol's path). */
  ingestUrls: Readonly<Record<IngestProtocol, string>>;
  /**
   * The phones were given an `https:` address: an upload over plain HTTP is
   * refused, whatever credential it carries (§6). With an `http:` address — a
   * home network while Trail is set up — every credential is taken over HTTP.
   */
  ingestHttpsOnly: boolean;
  /** Lower-cased addresses or `*@domain` entries. */
  signupAllowlist: readonly string[];
  trustProxy: TrustProxySetting;
  sessionTtlDays: number;
  liveWindowMinutes: number;
  staleAfterHours: number;
  /** Rows of the data access log are kept this many days. */
  dataAccessRetentionDays: number;
  /** Silent/recovered device alerts, or null when not configured. */
  alerts: AlertConfig | null;
  defaultTimezone: string;
  /** MapLibre styles; satellite imagery only when `MAP_STYLE_SATELLITE` is set. */
  mapStyles: { light: string; dark: string; satellite: SatelliteStyle | null };
  /** Extra CSP `connect-src`/`img-src` sources for the map (includes the styles' and tiles' origins). */
  mapOrigins: readonly string[];
  /** Built SPA directory (absolute). */
  webDistDir: string;
  logLevel: LogLevel;
  build: BuildInfo;
  rateLimits: RateLimitConfig;
  processing: ProcessingSettings;
}
