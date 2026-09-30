import { type APIRequestContext, expect } from "@playwright/test";
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
