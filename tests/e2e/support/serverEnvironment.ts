/** Where the suite starts its own server (a port of its own, next to `npm run dev`). */
export const e2eServerUrl = "http://localhost:4190";

/** The development Postgres (compose.yaml) holds a database just for this suite. */
export const defaultE2eDatabaseUrl = "postgres://trail:trail@127.0.0.1:54329/trail_e2e";

/** The suite's satellite imagery (MAP_STYLE_SATELLITE), a raster tile template. */
export const satelliteTiles = "https://imagery.e2e.trail.test/{z}/{x}/{y}.png";

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
    MCP_ALLOWED_ORIGINS: "",
    INGEST_BASE_URL: "",
    SIGNUP_ALLOWLIST: `*@${allowlistedDomain}`,
    TRUST_PROXY: "",
    SESSION_TTL_DAYS: "",
    LIVE_WINDOW_MINUTES: "",
    STALE_AFTER_HOURS: "",
    DATA_ACCESS_RETENTION_DAYS: "",
    ALERT_NTFY_URL: "",
    ALERT_NTFY_TOKEN: "",
    DEFAULT_TIMEZONE: "",
    MAP_STYLE_LIGHT: "",
    MAP_STYLE_DARK: "",
    // Satellite imagery from a host nobody serves: mapStyleStub answers its tiles.
    MAP_STYLE_SATELLITE: satelliteTiles,
    MAP_STYLE_SATELLITE_ATTRIBUTION: "Imagery for the end-to-end tests",
    MAP_CONNECT_SRC: "",
    WEB_DIST_DIR: "",
    LOG_LEVEL: "warn",
    APP_VERSION: "",
    GIT_SHA: "",
    BUILD_TIME: "",
    RATE_LIMIT_AUTH_PER_MINUTE: "100000",
    RATE_LIMIT_API_PER_MINUTE: "100000",
    RATE_LIMIT_INGEST_PER_MINUTE: "100000",
    RATE_LIMIT_INGEST_SINGLE_PER_MINUTE: "100000",
    RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES: "100000",
    RATE_LIMIT_TOKEN_PER_MINUTE: "100000",
    RATE_LIMIT_TOKEN_FAILED_PER_10_MINUTES: "100000",
    RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE: "100000",
    // One server for the suite: it queues and works out what the tests upload. In this role the
    // worker's liveness port stays closed (the API's /api/health/live is the probe).
    PROCESSING_ROLE: "all",
    PROCESSING_METRICS_PORT: "",
    PROCESSING_TEST_STALL: "",
    PROCESSING_ENABLED: "",
    // Empty here is not the default but "no map data": the suite never reaches Overpass, so the
    // mapped level degrades to averaged, as it does on a server without map data.
    PROCESSING_OVERPASS_URL: "",
    PROCESSING_OVERPASS_DAILY_MB: "",
    PROCESSING_OSM_TTL_DAYS: "",
    PROCESSING_MAX_ACCURACY_M: "",
    PROCESSING_STOP_MIN_S: "",
    // Empty is "no region" here: the suite never pulls map data from the registry.
    MAP_DATA_REGIONS: "",
    MAP_DATA_REGISTRY: "",
    MAP_DATA_REGISTRY_TOKEN: "",
    MAP_DATA_DIR: "",
    MAP_DATA_REFRESH_DAYS: "",
    MAP_DATA_MAX_GB: "",
    PROCESSING_PASS_MAX_POINTS: "",
    PROCESSING_PASS_MAX_SPAN_HOURS: "",
    LOAD_TEST: "",
    LAUNCHWAY_ENVIRONMENT: "",
  };
}
