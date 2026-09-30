import { defineConfig } from "tsdown";

/*
 * Two ESM bundles for Node: the server (dist/main.mjs) and the CLI
 * (dist/cli.mjs). npm dependencies stay external — the Docker image installs
 * the API's production dependencies next to dist — while the workspace
 * contracts package, which ships TypeScript source, is compiled in.
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
});
