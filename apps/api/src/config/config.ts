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
  /** Lower-cased addresses or `*@domain` entries. */
  signupAllowlist: readonly string[];
  trustProxy: TrustProxySetting;
  sessionTtlDays: number;
  liveWindowMinutes: number;
  staleAfterHours: number;
  /** Silent/recovered device alerts, or null when not configured. */
  alerts: AlertConfig | null;
  defaultTimezone: string;
  mapStyles: { light: string; dark: string };
  /** Extra CSP `connect-src`/`img-src` sources for the map (includes the style URLs' origins). */
  mapOrigins: readonly string[];
  /** Built SPA directory (absolute). */
  webDistDir: string;
  logLevel: LogLevel;
  build: BuildInfo;
  rateLimits: RateLimitConfig;
  processing: ProcessingSettings;
}
