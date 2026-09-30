import { fileURLToPath } from "node:url";

export interface RuntimePaths {
  migrationsFolder: string;
  webDistDir: string;
}

/**
 * Files the API needs at runtime, relative to the running entry module. The
 * bundle (`apps/api/dist/*.mjs`) and the sources run by tsx (`apps/api/src/*.ts`)
 * sit at the same depth, so the same relative paths work for both.
 */
export function runtimePaths(entryUrl: string): RuntimePaths {
  return {
    migrationsFolder: fileURLToPath(new URL("../drizzle", entryUrl)),
    webDistDir: fileURLToPath(new URL("../../web/dist", entryUrl)),
  };
}
