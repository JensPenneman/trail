import { resolve } from "node:path";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { z } from "zod";
import { defaultAppVersion, defaultCommit } from "./buildDefaults";
import type { Config } from "./config";
import { envSchema } from "./envSchema";
import { parseTrustProxy } from "./parseTrustProxy";
import { readSatelliteStyle } from "./satelliteStyle";

/** Invalid environment: `issues` lists every problem as `VARIABLE: message`. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n  ${issues.join("\n  ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const describeIssue = (issue: z.core.$ZodIssue): string =>
  issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message;

const originOf = (url: string): string => new URL(url).origin;

/**
 * Validates the environment (docs/architecture.md §4). `defaultWebDistDir` is
 * resolved by the entry point, relative to the running bundle.
 */
export function loadConfig(
  environment: NodeJS.ProcessEnv,
  defaults: { webDistDir: string },
): Config {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map(describeIssue));
  const env = parsed.data;

  const allowedOrigins = [...new Set([env.PUBLIC_URL, ...env.ADDITIONAL_ORIGINS])];
  const ingestBase = (env.INGEST_BASE_URL ?? env.PUBLIC_URL).replace(/\/+$/, "");
  // Checked by the schema: a problem never gets this far.
  const { style: satellite } = readSatelliteStyle(
    env.MAP_STYLE_SATELLITE,
    env.MAP_STYLE_SATELLITE_ATTRIBUTION,
  );
  const mapOrigins = [
    ...new Set([
      ...env.MAP_CONNECT_SRC,
      originOf(env.MAP_STYLE_LIGHT),
      originOf(env.MAP_STYLE_DARK),
      // The imagery's own host; a style that loads from more hosts lists them in MAP_CONNECT_SRC.
      ...(satellite === null
        ? []
        : [originOf(satellite.kind === "style" ? satellite.url : satellite.tiles)]),
    ]),
  ];

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    host: env.HOST,
    publicUrl: env.PUBLIC_URL,
    allowedOrigins,
    mcpAllowedOrigins: [...new Set([...allowedOrigins, ...env.MCP_ALLOWED_ORIGINS])],
    ingestUrl: `${ingestBase}${apiPaths.overland}`,
    ingestUrls: {
      overland: `${ingestBase}${apiPaths.overland}`,
      owntracks: `${ingestBase}${apiPaths.owntracks}`,
      osmand: `${ingestBase}${apiPaths.osmand}`,
    },
    ingestHttpsOnly: new URL(ingestBase).protocol === "https:",
    signupAllowlist: env.SIGNUP_ALLOWLIST,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    sessionTtlDays: env.SESSION_TTL_DAYS,
    liveWindowMinutes: env.LIVE_WINDOW_MINUTES,
    staleAfterHours: env.STALE_AFTER_HOURS,
    dataAccessRetentionDays: env.DATA_ACCESS_RETENTION_DAYS,
    alerts:
      env.ALERT_NTFY_URL === undefined
        ? null
        : { url: env.ALERT_NTFY_URL, token: env.ALERT_NTFY_TOKEN ?? null },
    defaultTimezone: env.DEFAULT_TIMEZONE,
    mapStyles: { light: env.MAP_STYLE_LIGHT, dark: env.MAP_STYLE_DARK, satellite },
    mapOrigins,
    webDistDir:
      env.WEB_DIST_DIR === undefined
        ? defaults.webDistDir
        : resolve(process.cwd(), env.WEB_DIST_DIR),
    logLevel: env.LOG_LEVEL,
    build: {
      version: env.APP_VERSION ?? defaultAppVersion,
      commit: env.GIT_SHA ?? defaultCommit,
      builtAt: env.BUILD_TIME === undefined ? null : new Date(env.BUILD_TIME).toISOString(),
    },
    rateLimits: {
      authPerMinute: env.RATE_LIMIT_AUTH_PER_MINUTE,
      apiPerMinute: env.RATE_LIMIT_API_PER_MINUTE,
      ingestPerMinute: env.RATE_LIMIT_INGEST_PER_MINUTE,
      ingestSinglePerMinute: env.RATE_LIMIT_INGEST_SINGLE_PER_MINUTE,
      ingestFailedPer10Minutes: env.RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES,
      tokenPerMinute: env.RATE_LIMIT_TOKEN_PER_MINUTE,
      tokenFailedPer10Minutes: env.RATE_LIMIT_TOKEN_FAILED_PER_10_MINUTES,
      publicSharePerMinute: env.RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE,
    },
    processing: {
      role: env.PROCESSING_ROLE,
      metricsPort: env.PROCESSING_METRICS_PORT,
      testStall: env.PROCESSING_TEST_STALL,
      enabled: env.PROCESSING_ENABLED,
      overpassUrl: env.PROCESSING_OVERPASS_URL,
      overpassDailyBytes: env.PROCESSING_OVERPASS_DAILY_MB * 1_000_000,
      osmTtlDays: env.PROCESSING_OSM_TTL_DAYS,
      maxAccuracyM: env.PROCESSING_MAX_ACCURACY_M,
      stopMinS: env.PROCESSING_STOP_MIN_S,
      passMaxPoints: env.PROCESSING_PASS_MAX_POINTS,
      passMaxSpanHours: env.PROCESSING_PASS_MAX_SPAN_HOURS,
    },
    loadTest: env.LOAD_TEST,
    launchwayEnvironment: env.LAUNCHWAY_ENVIRONMENT ?? null,
  };
}
