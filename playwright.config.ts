import { defineConfig, devices } from "@playwright/test";
import {
  defaultE2eDatabaseUrl,
  e2eServerEnvironment,
  e2eServerUrl,
} from "./tests/e2e/support/serverEnvironment";

/*
 * End-to-end tests of the whole stack (docs/architecture.md §16). By default
 * Playwright starts the built server (`npm run build` first) on its own port
 * against a freshly emptied trail_e2e database. With E2E_BASE_URL the same
 * suite runs against a deployment that is already up (e.g. the Docker stack)
 * and nothing is started or reset.
 */
const externalBaseUrl = process.env["E2E_BASE_URL"];
const baseURL = externalBaseUrl ?? e2eServerUrl;
const onCi = process.env["CI"] !== undefined;
// WebKit refuses a few "restricted" ports, among them 4190 (ManageSieve) of the suite's own
// server, so its project runs against deployments on other ports (E2E_BASE_URL).
const webkitCanConnect = new URL(baseURL).port !== "4190";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: onCi,
  // One retry on CI marks a flaky test in the report instead of blocking a deploy.
  retries: onCi ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    // New accounts live in Europe/Brussels (DEFAULT_TIMEZONE); the browser agrees with them.
    locale: "en-GB",
    timezoneId: "Europe/Brussels",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // The first account of a fresh server is its administrator (invites need one).
      name: "setup",
      testMatch: /\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      // Chromium, because only Chromium has the CDP virtual authenticator for passkeys.
      name: "iphone",
      use: { ...devices["iPhone 17 Pro"], browserName: "chromium" },
      dependencies: ["setup"],
    },
    ...(webkitCanConnect
      ? [
          {
            // Safari's engine, for what needs no passkey: the signed-out pages.
            name: "webkit",
            use: { ...devices["iPhone 17 Pro"] },
            grep: /@signed-out/,
          },
        ]
      : []),
  ],
  ...(externalBaseUrl === undefined
    ? {
        webServer: {
          command: "node scripts/e2e-server.mjs",
          url: `${e2eServerUrl}/api/health`,
          env: e2eServerEnvironment(process.env["E2E_DATABASE_URL"] ?? defaultE2eDatabaseUrl),
          reuseExistingServer: false,
          timeout: 90_000,
          // Exercises the server's own graceful shutdown (it needs up to 13 s).
          gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
          stdout: "pipe",
          stderr: "pipe",
        },
      }
    : {}),
});
