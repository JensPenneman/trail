import { apiPaths } from "@trail/contracts/apiPaths";
import { requestsHealthSchema } from "@trail/contracts/health";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createApiToken } from "../support/apiTokenFlows";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * `/api/health/requests` (docs/architecture.md §8.10): the API's own timing of
 * its requests per route pattern, from memory, against the route budgets —
 * for administrators (a session or an administrator's API token), behind the
 * same per-address limit as `/api/health/processing`, and numbers only: no path with an id, no account, no token, no query.
 */
let t: TestContext;
let email = "";
let deviceId = "";
let token = "";
let adminToken = "";
let adminCookie = "";
let memberCookie = "";
const lines: string[] = [];

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ logDestination: { write: (line: string) => lines.push(line) } });
  email = "first@example.com";
  const { agent, cookie } = await signUpWithCookie(t.app, email);
  adminCookie = cookie;
  adminToken = (
    await createApiToken(agent, { name: "Monitor", scopes: ["profile:read"], expiresAt: null })
  ).secret;
  memberCookie = (await signUpWithCookie(t.app, "member@allowed.test")).cookie;
  const device = await createDevice(agent, { name: "iPhone" });
  deviceId = device.device.id;
  token = device.credentials.accessToken;
  await postOverland(t.app, token, overlandFixture()).expect(200);
  await agent.get(apiPaths.devices.root).expect(200);
  await agent.get(apiPaths.devices.one(deviceId)).expect(200);
  await agent
    .get(apiPaths.tracks)
    .query({ from: "2026-09-28T22:00:00.000Z", to: "2026-09-29T22:00:00.000Z" })
    .expect(200);
  await agent.get(apiPaths.v1.devices.mode(deviceId)).expect(200);
});

afterAll(async () => {
  await t.close();
});

const summary = async () => {
  const response = await request(t.app)
    .get(apiPaths.healthRequests)
    .set("Authorization", bearer(adminToken))
    .expect(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["set-cookie"]).toBeUndefined();
  return { body: requestsHealthSchema.parse(response.body), text: response.text };
};

describe("/api/health/requests", () => {
  it("refuses anyone who is not an administrator, like the other administration", async () => {
    await request(t.app).get(apiPaths.healthRequests).expect(401);
    await request(t.app)
      .get(apiPaths.healthRequests)
      .set("Authorization", bearer(`trlk_${"A".repeat(43)}`))
      .expect(401);
    await request(t.app).get(apiPaths.healthRequests).set("Cookie", memberCookie).expect(403);
    const admin = await request(t.app)
      .get(apiPaths.healthRequests)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(requestsHealthSchema.parse(admin.body).routes.length).toBeGreaterThan(0);
  });

  it("counts every route by its pattern with its budget, and says nothing of whom", async () => {
    const { body, text } = await summary();
    expect(body).toMatchObject({ version: expect.any(String) });
    expect(["ok", "over_budget"]).toContain(body.status);
    const byRoute = new Map(body.routes.map((route) => [`${route.method} ${route.route}`, route]));
    // Counts, budgets and shape: how fast a cold request was depends on the machine.
    expect(byRoute.get("GET /api/devices")).toMatchObject({
      budgetMs: 100,
      last15m: { count: 1, errors: 0, aborted: 0 },
      last24h: { count: 1 },
    });
    expect(byRoute.get("GET /api/devices/:id")).toMatchObject({
      budgetMs: 1000,
      last15m: { count: 1 },
    });
    expect(byRoute.get("GET /api/tracks")).toMatchObject({ budgetMs: 400, last15m: { count: 1 } });
    expect(byRoute.get("GET /api/v1/devices/:id/mode")).toMatchObject({ budgetMs: 1000 });
    // An upload's targets go by its batch size (§3.1): counted, never judged here.
    expect(byRoute.get("POST /api/overland")).toMatchObject({ budgetMs: null, overBudget: false });
    for (const route of body.routes) {
      expect(route.last15m.p95Ms ?? 0).toBeGreaterThanOrEqual(route.last15m.p50Ms ?? 0);
      expect(route.last24h.maxMs ?? 0).toBeGreaterThanOrEqual(route.last24h.p95Ms ?? 0);
    }
    for (const secret of [deviceId, token, adminToken, email, "2026-09-28"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("marks a route whose last 15 minutes went over its budget", async () => {
    // Fixed durations, not timings of this run: a budget's verdict is the unit tests' (requestStats).
    for (let index = 0; index < 20; index += 1) {
      t.ctx.requests.record("GET /api/heatmap", 900, { status: 200, bytes: 2000 });
    }
    const { body } = await summary();
    expect(body.status).toBe("over_budget");
    expect(body.routes.find((route) => route.route === "/api/heatmap")).toMatchObject({
      method: "GET",
      budgetMs: 150,
      overBudget: true,
      last15m: { count: 20, overBudget: 20, maxMs: 900, meanBytes: 2000 },
    });
  });

  it("logs each request once, with its pattern and timing and without its URL", async () => {
    const parsed = lines.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    const completed = parsed.filter((entry) => entry["msg"] === "request completed");
    const perRequest = new Map<string, number>();
    for (const entry of completed) {
      const id = (entry["req"] as { id: string }).id;
      perRequest.set(id, (perRequest.get(id) ?? 0) + 1);
    }
    expect(perRequest.size).toBeGreaterThan(0);
    for (const count of perRequest.values()) expect(count).toBe(1);
    const line = completed.find((entry) => entry["route"] === "/api/devices/:id");
    expect(line).toMatchObject({
      msg: "request completed",
      res: { statusCode: 200 },
      conditional: false,
    });
    expect(line?.["ms"]).toBeTypeOf("number");
    expect(line?.["account"]).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(JSON.stringify(line)).not.toContain(deviceId);
    const days = completed.find((entry) => entry["route"] === "/api/tracks");
    expect(days).toMatchObject({ days: 1 });
  });
});

describe("its limit", () => {
  it("is the one the processing health check has, shared per address", async () => {
    const limited = await createTestContext({ env: { RATE_LIMIT_API_PER_MINUTE: "3" } });
    try {
      await request(limited.app).get(apiPaths.healthProcessing);
      await request(limited.app).get(apiPaths.health);
      await request(limited.app).get(apiPaths.healthRequests).expect(401);
      await request(limited.app).get(apiPaths.healthRequests).expect(429);
      // The container's liveness check is never limited.
      await request(limited.app).get(apiPaths.healthLive).expect(200);
    } finally {
      await limited.close();
    }
  });
});
