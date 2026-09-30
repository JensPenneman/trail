import { resolve } from "node:path";
import type { z } from "zod";
import { defaultAppVersion, defaultCommit } from "./buildDefaults";
import type { Config } from "./config";
import { envSchema } from "./envSchema";
import { parseTrustProxy } from "./parseTrustProxy";

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
  const mapOrigins = [
    ...new Set([
      ...env.MAP_CONNECT_SRC,
      originOf(env.MAP_STYLE_LIGHT),
      originOf(env.MAP_STYLE_DARK),
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
    ingestUrl: `${ingestBase}/api/overland`,
    signupAllowlist: env.SIGNUP_ALLOWLIST,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    sessionTtlDays: env.SESSION_TTL_DAYS,
    liveWindowMinutes: env.LIVE_WINDOW_MINUTES,
    staleAfterHours: env.STALE_AFTER_HOURS,
    alerts:
      env.ALERT_NTFY_URL === undefined
        ? null
        : { url: env.ALERT_NTFY_URL, token: env.ALERT_NTFY_TOKEN ?? null },
    defaultTimezone: env.DEFAULT_TIMEZONE,
    mapStyles: { light: env.MAP_STYLE_LIGHT, dark: env.MAP_STYLE_DARK },
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
      ingestFailedPer10Minutes: env.RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES,
    },
  };
}
