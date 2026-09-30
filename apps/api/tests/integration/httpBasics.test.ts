import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicConfigSchema } from "@trail/contracts/config";
import { apiErrorSchema } from "@trail/contracts/errors";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;
let spa: TestContext;
let webDist: string;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  webDist = mkdtempSync(join(tmpdir(), "trail-web-"));
  mkdirSync(join(webDist, "assets"));
  writeFileSync(
    join(webDist, "index.html"),
    '<!doctype html><script type="module" src="/assets/app-3f9a.js"></script>',
  );
  writeFileSync(join(webDist, "assets", "app-3f9a.js"), "console.log('trail');");
  writeFileSync(join(webDist, "manifest.webmanifest"), '{"name":"Trail"}');
  spa = await createTestContext({ webDistDir: webDist });
});

afterAll(async () => {
  await t.close();
  await spa.close();
  rmSync(webDist, { recursive: true, force: true });
});

const expectedCsp =
  "default-src 'self';script-src 'self';style-src 'self';img-src 'self' data: blob: https://tiles.openfreemap.org;" +
  "connect-src 'self' https://tiles.openfreemap.org;worker-src 'self' blob:;child-src 'self' blob:;font-src 'self';" +
  "manifest-src 'self';object-src 'none';base-uri 'none';form-action 'self';frame-ancestors 'none'";

describe("health and configuration", () => {
  it("reports health with a database round trip", async () => {
    const response = await request(t.app).get("/api/health").expect(200);
    expect(response.body).toMatchObject({
      status: "ok",
      db: "ok",
      version: expect.any(String),
      commit: "dev",
    });
    expect(response.body.uptimeS).toBeGreaterThanOrEqual(0);
    const live = await request(t.app).get("/api/health/live").expect(200);
    expect(live.body).toMatchObject({ status: "ok" });
    expect(live.body).not.toHaveProperty("db");
  });

  it("answers 503 when the database is down (liveness stays up)", async () => {
    const offline = await createTestContext({
      env: { DATABASE_URL: "postgres://trail:trail@127.0.0.1:1/trail_test" },
    });
    try {
      const response = await request(offline.app).get("/api/health").expect(503);
      expect(response.body).toMatchObject({ status: "unavailable", db: "down" });
      await request(offline.app).get("/api/health/live").expect(200);
      const api = await request(offline.app)
        .get("/api/auth/session")
        .set("Cookie", `trail_session=${"a".repeat(43)}`)
        .expect(503);
      expect(apiErrorSchema.parse(api.body).error.code).toBe("unavailable");
    } finally {
      await offline.close();
    }
  });

  it("publishes the public configuration", async () => {
    const response = await request(t.app).get("/api/config").expect(200);
    expect(publicConfigSchema.parse(response.body)).toMatchObject({
      appName: "Trail",
      publicUrl: testOrigin,
      ingestUrl: `${testOrigin}/api/overland`,
      thresholds: { liveMinutes: 15, staleHours: 12 },
      features: { alerts: false },
      builtAt: null,
    });
  });
});

describe("security headers", () => {
  it("sends the CSP and friends of the specification over HTTP", async () => {
    const response = await request(t.app).get("/api/config").expect(200);
    expect(response.headers["content-security-policy"]).toBe(expectedCsp);
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    expect(response.headers["referrer-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers["origin-agent-cluster"]).toBe("?1");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    const permissions = String(response.headers["permissions-policy"]);
    expect(permissions).toContain("publickey-credentials-get=(self)");
    expect(permissions).toContain("publickey-credentials-create=(self)");
    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("geolocation=()");
  });

  it("adds HSTS and upgrade-insecure-requests behind an HTTPS proxy", async () => {
    const response = await request(t.app)
      .get("/api/config")
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(response.headers["content-security-policy"]).toBe(
      `${expectedCsp};upgrade-insecure-requests`,
    );
  });

  it("tags every response with a request id (a proxy's id is kept)", async () => {
    const generated = await request(t.app).get("/api/health/live");
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const forwarded = await request(t.app)
      .get("/api/health/live")
      .set("X-Request-Id", "cf-ray-8c1f2a3b4c5d");
    expect(forwarded.headers["x-request-id"]).toBe("cf-ray-8c1f2a3b4c5d");
    const hostile = await request(t.app).get("/api/health/live").set("X-Request-Id", "<script>");
    expect(hostile.headers["x-request-id"]).not.toBe("<script>");
  });
});

describe("routing", () => {
  it("answers unknown API routes with a JSON 404", async () => {
    const response = await request(t.app).get("/api/nope").expect(404);
    expect(apiErrorSchema.parse(response.body).error.code).toBe("not_found");
  });

  it("serves the API only when there is no built web app", async () => {
    const response = await request(t.app).get("/").expect(404);
    expect(response.headers["content-type"]).toMatch(/^text\/plain/);
  });
});

describe("static web app", () => {
  it("serves index.html for client-side routes, never cached", async () => {
    for (const path of [
      "/",
      "/devices/0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
      "/link/abc_DEF-123",
    ]) {
      const response = await request(spa.app).get(path).expect(200);
      expect(response.headers["content-type"]).toMatch(/^text\/html/);
      expect(response.headers["cache-control"]).toBe("no-cache");
      expect(response.headers["content-security-policy"]).toBe(expectedCsp);
      expect(response.text).toContain("/assets/app-3f9a.js");
    }
  });

  it("caches hashed assets for a year", async () => {
    const response = await request(spa.app).get("/assets/app-3f9a.js").expect(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("revalidates other files and 404s missing ones", async () => {
    const manifest = await request(spa.app).get("/manifest.webmanifest").expect(200);
    expect(manifest.headers["cache-control"]).toBe("no-cache");
    await request(spa.app).get("/assets/missing.js").expect(404);
    await request(spa.app).get("/missing.png").expect(404);
    await request(spa.app).post("/").set("Origin", testOrigin).expect(404);
    const api = await request(spa.app).get("/api/missing").expect(404);
    expect(apiErrorSchema.parse(api.body).error.code).toBe("not_found");
  });
});
