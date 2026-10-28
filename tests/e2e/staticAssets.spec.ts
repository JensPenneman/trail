import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { test } from "./support/test";

const javascript = /^(text|application)\/javascript/;

/** Every chunk the app can load, following the chunks' references from the page. */
async function chunks(request: APIRequestContext, html: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const queue = [...html.matchAll(/(?:src|href)="(\/assets\/[\w.-]+\.js)"/g)].map(
    (match) => match[1],
  );
  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined || found.has(path)) continue;
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    found.set(path, response.headers()["content-type"] ?? "");
    const code = await response.text();
    for (const match of code.matchAll(/(?:\.\/|\/assets\/)([\w-]+\.js)\b/g)) {
      queue.push(`/assets/${match[1]}`);
    }
  }
  return found;
}

test("the server hands out the web app with the right types, caching and headers", {
  tag: "@signed-out",
}, async ({ request }) => {
  const page = await request.get("/");
  expect(page.status()).toBe(200);
  const headers = page.headers();
  expect(headers["content-type"]).toBe("text/html; charset=utf-8");
  expect(headers["cache-control"]).toBe("no-cache");
  expect(headers["content-security-policy"]).toContain("script-src 'self';");
  expect(headers["content-security-policy"]).toContain("worker-src 'self' blob:;");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("publickey-credentials-get=(self)");
  expect(headers["x-powered-by"]).toBeUndefined();

  const loaded = await chunks(request, await page.text());
  const worker = [...loaded.keys()].find((path) => /\/maplibre-worker-[\w-]+\.js$/.test(path));
  expect(worker, "the MapLibre worker chunk").toBeDefined();
  for (const [path, type] of loaded) expect(type, path).toMatch(javascript);
  const immutable = await request.get(worker ?? "");
  expect(immutable.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.headers()["content-type"]).toBe("application/manifest+json; charset=utf-8");
  const { icons } = (await manifest.json()) as { icons: { src: string; type: string }[] };
  for (const icon of icons) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"], icon.src).toContain(icon.type);
  }
  for (const [path, type] of [
    ["/robots.txt", "text/plain; charset=utf-8"],
    ["/apple-touch-icon.png", "image/png"],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toBe(type);
  }

  // Page addresses get the app; missing files and API routes get a real 404.
  const deepLink = await request.get("/devices/some-device");
  expect(deepLink.headers()["content-type"]).toBe("text/html; charset=utf-8");
  expect((await request.get("/missing.png")).status()).toBe(404);
  expect((await request.get("/assets/missing.js")).status()).toBe(404);
  const api = await request.get("/api/missing");
  expect(api.status()).toBe(404);
  expect(await api.json()).toMatchObject({ error: { code: "not_found" } });
  expect(await (await request.get("/api/health")).json()).toMatchObject({ status: "ok", db: "ok" });
});

/** The shell the service worker keeps, from its own source: the files of its precache. */
async function precacheOf(request: APIRequestContext): Promise<string[]> {
  const worker = await request.get("/sw.js");
  const source = await worker.text();
  const config = /\)\((\{"version".*\})\);\s*$/s.exec(source)?.[1];
  expect(config, "the shell of the build in sw.js").toBeDefined();
  const { files } = JSON.parse(config ?? "{}") as { files: { url: string }[] };
  return files.map((file) => file.url);
}

test("the service worker keeps the app's shell, every chunk of it, and nothing of the API", {
  tag: "@signed-out",
}, async ({ request }) => {
  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toMatch(javascript);
  // A new build's worker must reach the browser: never cached.
  expect(worker.headers()["cache-control"]).toBe("no-cache");
  const precache = await precacheOf(request);
  expect(precache).toContain("/index.html");
  expect(precache).toContain("/manifest.webmanifest");
  const page = await request.get("/");
  for (const path of (await chunks(request, await page.text())).keys()) {
    expect(precache, path).toContain(path);
  }
  for (const icon of ["/favicon.svg", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]) {
    expect(precache, icon).toContain(icon);
  }
  expect(
    precache.filter((url) => !url.startsWith("/") || /^\/(?:api|docs|mcp)(?:\/|$)/.test(url)),
  ).toEqual([]);
  expect(precache).not.toContain("/sw.js");
});

/** Waits until the service worker installed the shell and controls the page; what it keeps. */
async function shellOf(page: Page) {
  return page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // It claims the open page once it is active.
    if (navigator.serviceWorker.controller === null) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      });
    }
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return { names, urls, controlled: navigator.serviceWorker.controller !== null };
  });
}

test(
  "Chrome offers to install the app",
  {
    tag: "@signed-out",
  },
  async ({ playwright, browserName, baseURL }, testInfo) => {
    test.skip(browserName !== "chromium", "installability is Chromium's");
    // A profile of its own: a test's usual context is a private window, where nothing installs.
    const context = await playwright.chromium.launchPersistentContext(
      testInfo.outputPath("profile"),
      {
        ...(baseURL === undefined ? {} : { baseURL }),
      },
    );
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto("/login");
      expect((await shellOf(page)).controlled).toBe(true);
      const cdp = await context.newCDPSession(page);
      const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
        installabilityErrors: { errorId: string }[];
      };
      expect(installabilityErrors).toEqual([]);
      const manifest = (await cdp.send("Page.getAppManifest")) as {
        url: string;
        errors: unknown[];
      };
      expect(new URL(manifest.url).pathname).toBe("/manifest.webmanifest");
      expect(manifest.errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
);

test("the service worker opens the shell without a network, and never answers the API", {
  tag: "@signed-out",
}, async ({ page, context, browserName, consoleGuard }) => {
  test.skip(browserName !== "chromium", "Playwright drives service workers in Chromium only");
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const shell = await shellOf(page);
  expect(shell.names).toHaveLength(1);
  expect(shell.names[0]).toMatch(/^trail-shell-[0-9a-f]{16}$/);
  const origin = new URL(page.url()).origin;
  const paths = shell.urls.map((url) => {
    expect(new URL(url).origin).toBe(origin);
    return new URL(url).pathname;
  });
  expect(paths).toContain("/index.html");
  expect(paths.some((path) => path.startsWith("/assets/"))).toBe(true);
  expect(paths.filter((path) => /^\/(?:api|docs|mcp)(?:\/|$)/.test(path))).toEqual([]);
  // The API's answers never come from the worker, also with it in control.
  const health = page.waitForResponse((response) => response.url().endsWith("/api/health"));
  await page.evaluate(() => fetch("/api/health").then((response) => response.status));
  expect((await health).fromServiceWorker()).toBe(false);

  // Without a network the shell still opens, from the worker, and so does a deep link. What
  // the pages ask the API meanwhile fails, as without a worker.
  consoleGuard.expectOffline();
  await context.setOffline(true);
  const failed: string[] = [];
  page.on("requestfailed", (request) => failed.push(new URL(request.url()).pathname));
  const reloaded = await page.reload();
  expect(reloaded?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const deep = await page.goto("/settings/about");
  expect(deep?.fromServiceWorker()).toBe(true);
  await expect(page.locator("#root > *")).not.toHaveCount(0);
  await context.setOffline(false);
  expect(failed.filter((path) => !path.startsWith("/api/"))).toEqual([]);
});
