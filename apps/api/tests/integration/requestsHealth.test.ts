import { apiPaths } from "@trail/contracts/apiPaths";
import { requestsHealthSchema } from "@trail/contracts/health";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * `/api/health/requests` (docs/architecture.md §8.10): the API's own timing of
 * its requests per route pattern, from memory, against the route budgets —
 * public like `/api/health/processing`, behind the same per-address limit,
 * and numbers only: no path with an id, no account, no token, no query.
 */
let t: TestContext;
let email = "";
let deviceId = "";
let token = "";
const lines: string[] = [];

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ logDestination: { write: (line: string) => lines.push(line) } });
  email = "first@example.com";
  const { agent } = await signUpWithCookie(t.app, email);
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
  const response = await request(t.app).get(apiPaths.healthRequests).expect(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["set-cookie"]).toBeUndefined();
  return { body: requestsHealthSchema.parse(response.body), text: response.text };
};

describe("/api/health/requests", () => {
  it("counts every route by its pattern with its budget, and says nothing of whom", async () => {
    const { body, text } = await summary();
    expect(body).toMatchObject({ status: "ok", version: expect.any(String) });
    const byRoute = new Map(body.routes.map((route) => [`${route.method} ${route.route}`, route]));
    expect(byRoute.get("GET /api/devices")).toMatchObject({
      budgetMs: 100,
      overBudget: false,
      last15m: { count: 1, errors: 0 },
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
    for (const secret of [deviceId, token, email, "2026-09-28"]) expect(text).not.toContain(secret);
  });

  it("marks a route whose last 15 minutes went over its budget", async () => {
    for (let index = 0; index < 3; index += 1) {
      t.ctx.requests.record("GET /api/heatmap", 900, { status: 200, bytes: 2000 });
    }
    const { body } = await summary();
    expect(body.status).toBe("over_budget");
    expect(body.routes[0]).toMatchObject({
      method: "GET",
      route: "/api/heatmap",
      budgetMs: 150,
      overBudget: true,
      last15m: { count: 3, overBudget: 3, maxMs: 900, meanBytes: 2000 },
    });
  });

  it("logs each request once, with its pattern and timing and without its URL", async () => {
    const line = lines
      .map((entry) => JSON.parse(entry) as Record<string, unknown>)
      .find((entry) => entry["route"] === "/api/devices/:id");
    expect(line).toMatchObject({
      msg: "request completed",
      res: { statusCode: 200 },
      conditional: false,
    });
    expect(line?.["ms"]).toBeTypeOf("number");
    expect(line?.["account"]).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(JSON.stringify(line)).not.toContain(deviceId);
    const days = lines
      .map((entry) => JSON.parse(entry) as Record<string, unknown>)
      .find((entry) => entry["route"] === "/api/tracks");
    expect(days).toMatchObject({ days: 1 });
  });
});

describe("its limit", () => {
  it("is the one the processing health check has, shared per address", async () => {
    const limited = await createTestContext({ env: { RATE_LIMIT_API_PER_MINUTE: "3" } });
    try {
      await request(limited.app).get(apiPaths.healthProcessing);
      await request(limited.app).get(apiPaths.health);
      await request(limited.app).get(apiPaths.healthRequests).expect(200);
      await request(limited.app).get(apiPaths.healthRequests).expect(429);
      // The container's liveness check is never limited.
      await request(limited.app).get(apiPaths.healthLive).expect(200);
    } finally {
      await limited.close();
    }
  });
});
