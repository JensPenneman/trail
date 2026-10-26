import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Files the build copies next to the server bundle (tsdown.config.ts `copy`),
 * because the image has neither docs/ nor the development dependencies. Run
 * from the sources (tsx, Vitest), this module sits in apps/api/src, where no
 * copy exists, and the originals are used.
 */
const copied = (name: string): string | null => {
  const path = fileURLToPath(new URL(name, import.meta.url));
  return existsSync(path) ? path : null;
};

/** docs/api.md: the guide of the public API, which becomes its OpenAPI description. */
export function apiGuidePath(): string {
  return copied("./api.md") ?? fileURLToPath(new URL("../../../docs/api.md", import.meta.url));
}

/** Scalar's standalone browser bundle for `/docs`, or null when it is missing. */
export function apiReferenceScriptPath(): string | null {
  const bundled = copied("./api-reference/standalone.js");
  if (bundled !== null) return bundled;
  try {
    const entry = createRequire(import.meta.url).resolve("@scalar/api-reference");
    const original = join(dirname(entry), "browser", "standalone.js");
    return existsSync(original) ? original : null;
  } catch {
    return null;
  }
}
