/** Express `trust proxy` value: hop count, boolean, or a list of addresses/subnet names. */
export type TrustProxySetting = boolean | number | string;

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

interface RateLimitConfig {
  /** Auth ceremonies and link lookups, per IP. */
  authPerMinute: number;
  /** Every other dashboard API request, per IP. */
  apiPerMinute: number;
  /** Accepted Overland uploads, per device token. */
  ingestPerMinute: number;
  /** Uploads with an unknown token, per IP. */
  ingestFailedPer10Minutes: number;
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
}
