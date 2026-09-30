/** Where the suite starts its own server (a port of its own, next to `npm run dev`). */
export const e2eServerUrl = "http://localhost:4190";

/** The development Postgres (compose.yaml) holds a database just for this suite. */
export const defaultE2eDatabaseUrl = "postgres://trail:trail@127.0.0.1:54329/trail_e2e";

/** Addresses at this domain may sign up without an invite (SIGNUP_ALLOWLIST). */
export const allowlistedDomain = "e2e.trail.test";

/**
 * The complete environment of the server under test (docs/architecture.md §4).
 * Playwright starts it with the shell's variables underneath, so every variable
 * the API reads is set here, empty meaning "the default": an unrelated
 * DATABASE_URL or NODE_ENV exported by the shell never reaches it. Rate limits
 * are raised because every test signs up from the same address.
 */
export function e2eServerEnvironment(databaseUrl: string): Record<string, string> {
  const { port } = new URL(e2eServerUrl);
  return {
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    PORT: port,
    HOST: "127.0.0.1",
    PUBLIC_URL: e2eServerUrl,
    ADDITIONAL_ORIGINS: "",
    INGEST_BASE_URL: "",
    SIGNUP_ALLOWLIST: `*@${allowlistedDomain}`,
    TRUST_PROXY: "",
    SESSION_TTL_DAYS: "",
    LIVE_WINDOW_MINUTES: "",
    STALE_AFTER_HOURS: "",
    ALERT_NTFY_URL: "",
    ALERT_NTFY_TOKEN: "",
    DEFAULT_TIMEZONE: "",
    MAP_STYLE_LIGHT: "",
    MAP_STYLE_DARK: "",
    MAP_CONNECT_SRC: "",
    WEB_DIST_DIR: "",
    LOG_LEVEL: "warn",
    APP_VERSION: "",
    GIT_SHA: "",
    BUILD_TIME: "",
    RATE_LIMIT_AUTH_PER_MINUTE: "100000",
    RATE_LIMIT_API_PER_MINUTE: "100000",
    RATE_LIMIT_INGEST_PER_MINUTE: "100000",
    RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES: "100000",
  };
}
