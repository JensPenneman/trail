/** The dashboard origin of the tests (PUBLIC_URL): passkeys bound to RP ID `localhost`. */
export const testOrigin = "http://localhost:5173";

/** A second allowed origin with its own RP ID (`trail.localhost`). */
export const otherOrigin = "http://trail.localhost:8080";

/** Integration tests own this database; every test file resets its schema. */
export const testDatabaseUrl =
  process.env["TEST_DATABASE_URL"] ?? "postgres://trail:trail@127.0.0.1:54329/trail_test";

/** Environment for `loadConfig` in tests; limits are high unless a test lowers them. */
export function testEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: testDatabaseUrl,
    PUBLIC_URL: testOrigin,
    ADDITIONAL_ORIGINS: otherOrigin,
    SIGNUP_ALLOWLIST: "first@example.com,*@allowed.test",
    TRUST_PROXY: "loopback",
    LOG_LEVEL: "silent",
    RATE_LIMIT_AUTH_PER_MINUTE: "100000",
    RATE_LIMIT_API_PER_MINUTE: "100000",
    RATE_LIMIT_INGEST_PER_MINUTE: "100000",
    RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES: "100000",
    ...overrides,
  };
}
