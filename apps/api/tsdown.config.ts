import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "tsdown";

/** Scalar's standalone browser bundle: the API reference at /docs, served from the image. */
const apiReferenceBundle = join(
  dirname(createRequire(import.meta.url).resolve("@scalar/api-reference")),
  "browser",
  "standalone.js",
);

/*
 * Two ESM bundles for Node: the server (dist/main.mjs) and the CLI
 * (dist/cli.mjs). npm dependencies stay external — the Docker image installs
 * the API's production dependencies next to dist — while the workspace
 * contracts package, which ships TypeScript source, is compiled in. The API
 * guide and the reference bundle are copied next to them (src/packagedFiles.ts):
 * the image has neither docs/ nor the development dependencies.
 */
export default defineConfig({
  entry: { main: "src/main.ts", cli: "src/cli.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  dts: false,
  deps: {
    alwaysBundle: [/^@trail\/contracts(\/|$)/],
  },
  copy: [
    { from: "../../docs/api.md", to: "dist" },
    { from: apiReferenceBundle, to: "dist/api-reference" },
  ],
});
