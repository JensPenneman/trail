import { fileURLToPath } from "node:url";

/**
 * Browser state (session cookie) of the server's first account, its
 * administrator, written by admin.setup.ts for the tests that need one. It
 * lives in Playwright's output folder, which every run empties first.
 */
export const adminStatePath = fileURLToPath(
  new URL("../../../test-results/.auth/admin.json", import.meta.url),
);
