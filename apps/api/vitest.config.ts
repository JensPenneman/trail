import { defineConfig } from "vitest/config";

/*
 * `unit` — pure logic, parallel. `integration` — the real app against the
 * `trail_test` database (TEST_DATABASE_URL); every file resets the schema, so
 * files run one after the other.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
