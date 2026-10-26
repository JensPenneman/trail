import { apiPaths } from "@trail/contracts/apiPaths";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createV1Router } from "../../src/v1/createV1Router";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;
let owner: Agent;
let ownerId = "";
let deviceId = "";

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  ownerId = (await signUp(owner, new SoftwareAuthenticator(), "first@example.com")).user.id;
  deviceId = (await createDevice(owner, { name: "Phone" })).device.id;
});

afterAll(async () => {
  await t.close();
});

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** `METHOD /api/v1/…{param}` of every operation in the served document. */
function documentedOperations(document: { paths?: Record<string, Record<string, unknown>> }) {
  return Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    methods.filter((method) => method in item).map((method) => `${method.toUpperCase()} ${path}`),
  );
}

describe("the OpenAPI document and the router", () => {
  it("describe exactly the same operations", async () => {
    const document = (await request(t.app).get(apiPaths.v1.openApi).expect(200)).body;
    const router = createV1Router(t.ctx);
    const mounted = router.stack.flatMap(({ route }) => {
      if (route === undefined) return [];
      const template = `${apiPaths.v1.root}${route.path.replace(/:(\w+)/g, "{$1}")}`;
      return route.stack.map((handler) => `${handler.method.toUpperCase()} ${template}`);
    });
    expect(mounted.sort()).toEqual(documentedOperations(document).sort());
    expect(mounted.length).toBeGreaterThanOrEqual(5);
  });

  it("serves every documented operation from the app (none falls through to the 404)", async () => {
    const document = (await request(t.app).get(apiPaths.v1.openApi).expect(200)).body;
    for (const operation of documentedOperations(document)) {
      const [method = "", template = ""] = operation.split(" ");
      const path = template.replace(/\{\w+\}/g, deviceId);
      const response = await owner[method.toLowerCase() as "get"](path).set("Origin", testOrigin);
      const fellThrough =
        response.status === 404 && response.body?.error?.message === "No such API route.";
      expect(fellThrough, operation).toBe(false);
      expect(response.status, operation).toBeLessThan(500);
    }
  });
});

describe("GET /api/v1/openapi.json", () => {
  it("is public, cacheable, revalidates and is open to other origins", async () => {
    const response = await request(t.app)
      .get(apiPaths.v1.openApi)
      .set("Origin", "https://tools.example")
      .expect(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    const etag = String(response.headers["etag"]);
    expect(etag).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
    expect(response.body).toMatchObject({
      openapi: "3.1.1",
      info: { title: "Trail API", version: t.ctx.config.build.version },
      servers: [{ url: testOrigin }],
    });
    const again = await request(t.app).get(apiPaths.v1.openApi).expect(200);
    expect(again.headers["etag"]).toBe(etag);
    const unchanged = await request(t.app)
      .get(apiPaths.v1.openApi)
      .set("If-None-Match", etag)
      .expect(304);
    expect(unchanged.text).toBe("");
    await request(t.app).head(apiPaths.v1.openApi).expect(200);
  });

  it("never loads the session, so a cache cannot hand a cookie on", async () => {
    // A signed-in browser sends its cookie along (the /docs page fetches the document).
    const dueForRefresh = () =>
      t.ctx.pool.query(
        "UPDATE sessions SET last_seen_at = now() - interval '1 hour' WHERE user_id = $1",
        [ownerId],
      );
    await dueForRefresh();
    const document = await owner.get(apiPaths.v1.openApi).expect(200);
    expect(document.headers["set-cookie"]).toBeUndefined();
    // A route that reads the session slides it forward: the check above is not vacuous.
    await dueForRefresh();
    const me = await owner.get(apiPaths.v1.me).expect(200);
    expect(String(me.headers["set-cookie"])).toMatch(/^trail_session=/);
    // Nor is a cookie the server does not know cleared here.
    const unknown = await request(t.app)
      .get(apiPaths.v1.openApi)
      .set("Cookie", `trail_session=${"x".repeat(43)}`)
      .expect(200);
    expect(unknown.headers["set-cookie"]).toBeUndefined();
  });
});
