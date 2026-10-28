/* The service worker of the production build (docs/architecture.md §14):
 * written into the web app's dist directory once Vite has built it. It keeps
 * the app's shell — the page, its hashed assets, the manifest and the icons —
 * so that Trail opens without a network, and never answers anything under
 * /api: the API's copy is the browser store, with its owner, purges and
 * contracts, and a second cache without them would be a liability.
 *
 * Written here rather than with workbox-build, which brings 280 packages for
 * this one file, an advisory without a fix among them (deepmerge), and a
 * second place deciding what is built. */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Navigations the shell never answers: the API, its reference, the MCP
 * server, and any address of a file (the server answers a missing one with a
 * 404, as without a worker).
 */
const navigationDenylist = ["^/api(?:/|$)", "^/docs(?:/|$)", "^/mcp(?:/|$)", "/[^/]+\\.[^/]+$"];

/** @param {string} path a file of the build, relative to it, with "/" */
const isShell = (path) =>
  path === "index.html" ||
  path === "manifest.webmanifest" ||
  (path.startsWith("assets/") && !path.endsWith(".map")) ||
  (!path.includes("/") && /\.(?:png|svg|ico)$/.test(path));

/** @param {string} text */
const shortHash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * @typedef {{ url: string; revision: string | null }} ShellFile
 * @typedef {{ version: string; files: ShellFile[]; denylist: string[] }} ShellConfig
 * @typedef {{ waitUntil(promise: Promise<unknown>): void }} ShellEvent
 * @typedef {ShellEvent & { request: Request; respondWith(response: Promise<Response>): void }} ShellFetchEvent
 * @typedef {{
 *   addEventListener(type: "install" | "activate", listener: (event: ShellEvent) => void): void;
 *   addEventListener(type: "fetch", listener: (event: ShellFetchEvent) => void): void;
 *   skipWaiting(): Promise<void>;
 *   clients: { claim(): Promise<void> };
 *   location: Location;
 * }} ShellScope
 */

/**
 * The worker itself, written into sw.js as its source text (so it must use
 * nothing from this module). Installs the shell into a cache of this build
 * and takes over at once; drops the caches of older builds; answers the
 * app's navigations with the kept page and the shell's files from the cache,
 * everything else from the network as if there were no worker.
 *
 * @param {ShellConfig} config
 */
function serviceWorker(config) {
  const scope = /** @type {ShellScope} */ (/** @type {unknown} */ (self));
  const cacheName = `trail-shell-${config.version}`;
  const shell = new Set(config.files.map((file) => file.url));
  const denied = config.denylist.map((source) => new RegExp(source));
  const page = "/index.html";

  scope.addEventListener("install", (event) => {
    event.waitUntil(
      caches
        .open(cacheName)
        .then((cache) =>
          cache.addAll(config.files.map((file) => new Request(file.url, { cache: "reload" }))),
        )
        .then(() => scope.skipWaiting()),
    );
  });

  scope.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith("trail-shell-") && name !== cacheName)
              .map((name) => caches.delete(name)),
          ),
        )
        .then(() => scope.clients.claim()),
    );
  });

  /**
   * The app's page as kept, at once. The network's is fetched meanwhile and
   * kept for the next open when it is the same page with other headers (a
   * new Content-Security-Policy after a configuration change): a page of
   * another build waits for that build's worker, which keeps its assets with it.
   *
   * @param {ShellFetchEvent} event
   */
  const answerPage = async (event) => {
    const cache = await caches.open(cacheName);
    const kept = await cache.match(page);
    const fresh = fetch(page, { cache: "no-cache", credentials: "same-origin" }).then(
      async (response) => {
        if (!response.ok) return response;
        const same =
          kept !== undefined && (await response.clone().text()) === (await kept.clone().text());
        if (kept === undefined || same) await cache.put(page, response.clone());
        return response;
      },
    );
    if (kept === undefined) return fresh;
    event.waitUntil(fresh.catch(() => undefined));
    return kept;
  };

  /** @param {Request} request @param {string} path */
  const answerFile = async (request, path) => {
    const cache = await caches.open(cacheName);
    return (await cache.match(path)) ?? fetch(request);
  };

  scope.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== scope.location.origin) return;
    if (request.mode === "navigate") {
      if (denied.some((pattern) => pattern.test(url.pathname))) return;
      event.respondWith(answerPage(event));
      return;
    }
    if (shell.has(url.pathname)) event.respondWith(answerFile(request, url.pathname));
  });
}

/** @param {string} directory @returns {Promise<string[]>} every file below it, relative, with "/" */
async function filesBelow(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

/**
 * Writes `sw.js` into the built web app: the worker above with the shell of
 * this build — every file it needs, revisioned (hashed assets by their name,
 * the others by their content) — so that each build's worker differs from
 * the last and browsers install it.
 *
 * @param {string} distDir the web app's build (apps/web/dist)
 * @returns {Promise<ShellConfig>}
 */
export async function writeServiceWorker(distDir) {
  const files = [];
  for (const path of (await filesBelow(distDir)).filter(isShell)) {
    const revision = path.startsWith("assets/")
      ? null
      : shortHash(await readFile(join(distDir, path), "utf8"));
    files.push({ url: `/${path}`, revision });
  }
  if (!files.some((file) => file.url === "/index.html")) {
    throw new Error(`${distDir} holds no index.html: build the web app first`);
  }
  const version = shortHash(JSON.stringify(files));
  /** @type {ShellConfig} */
  const config = { version, files, denylist: navigationDenylist };
  const source = [
    "/* Trail's service worker: the app's shell, never the API (scripts/serviceWorker.mjs). */",
    `"use strict";`,
    `(${serviceWorker.toString()})(${JSON.stringify(config)});`,
    "",
  ].join("\n");
  await writeFile(join(distDir, "sw.js"), source);
  return config;
}
