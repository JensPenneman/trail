import { defineConfig } from "vitest/config";
import { unitTestOptions } from "../../vitest.shared.ts";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    ...unitTestOptions(),
  },
});
