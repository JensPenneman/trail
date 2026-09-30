/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const maplibreWorkerModule = "maplibre-gl/dist/maplibre-gl-worker.mjs";
const workerUrlModule = "virtual:maplibre-worker-url";
const resolvedWorkerUrlModule = `\0${workerUrlModule}`;

/**
 * MapLibre 6 starts a module worker that it expects next to its own ESM file
 * (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`), which no longer
 * exists once the library is bundled. In builds the worker is emitted as an
 * extra entry chunk of the same bundle, so it shares the big
 * `maplibre-gl-shared` chunk with the map code instead of carrying a second
 * copy, and its hashed same-origin URL (allowed by `worker-src 'self'`) is
 * exported by a virtual module for `setWorkerUrl()`. The dev server serves the
 * untouched worker file straight from node_modules.
 */
function maplibreWorker(): Plugin {
  let command: "build" | "serve" = "serve";
  return {
    name: "trail:maplibre-worker",
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      return id === workerUrlModule ? resolvedWorkerUrlModule : null;
    },
    async load(id) {
      if (id !== resolvedWorkerUrlModule) return null;
      if (command === "serve") {
        const resolved = await this.resolve(maplibreWorkerModule);
        if (resolved === null) throw new Error(`Cannot resolve ${maplibreWorkerModule}`);
        return `export default ${JSON.stringify(`/@fs${resolved.id}`)};`;
      }
      const referenceId = this.emitFile({
        type: "chunk",
        id: maplibreWorkerModule,
        name: "maplibre-worker",
      });
      return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), maplibreWorker()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    // MapLibre alone is ~600 kB minified; it is only ever loaded lazily by the map views.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Libraries that change rarely get chunks of their own, so a deploy that only
          // touches app code leaves them cached in the browser.
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "router", test: /node_modules[\\/]react-router[\\/]/ },
            { name: "query", test: /node_modules[\\/]@tanstack[\\/]/ },
            // With zod goes the module that configures it (see src/app/zodJitless.ts).
            { name: "zod", test: /node_modules[\\/]zod[\\/]|[\\/]src[\\/]app[\\/]zodJitless\.ts$/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
    css: false,
  },
  server: {
    port: 5173,
    // Passkeys are bound to the dashboard origin (PUBLIC_URL=http://localhost:5173), so
    // silently moving to another port would break sign-in.
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        xfwd: true,
        configure(proxy) {
          // The event stream must reach the browser event by event: asking the API for an
          // uncompressed response keeps any compression middleware from buffering it.
          proxy.on("proxyReq", (proxyRequest, request) => {
            if (request.url?.startsWith("/api/events") === true) {
              proxyRequest.setHeader("accept-encoding", "identity");
            }
          });
        },
      },
    },
  },
});
