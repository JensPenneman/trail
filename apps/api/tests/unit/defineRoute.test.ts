import type { ApiScope } from "@trail/contracts/apiScope";
import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AppContext } from "../../src/appContext";
import { type RequestAuth, setRequestAuth, type UserRow } from "../../src/auth/requestAuth";
import { createErrorHandler } from "../../src/http/errorHandler";
import { createLogger } from "../../src/logging/createLogger";
import { defineRoute, missingScopes, type V1Route } from "../../src/v1/defineRoute";
import { pathParameters, toExpressPath } from "../../src/v1/toExpressPath";

const logger = createLogger({ level: "silent" });
// The handlers below never touch the context; the route only hands it through.
const ctx = { logger } as unknown as AppContext;

const user: UserRow = {
  id: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60",
  email: "jens@example.com",
  displayName: "Jens",
  webauthnUserId: Buffer.alloc(32),
  isAdmin: false,
  timezone: "Europe/Brussels",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const session: RequestAuth = { kind: "session", user, sessionId: "s".repeat(64) };
const token = (scopes: ApiScope[]): RequestAuth => ({
  kind: "token",
  user,
  tokenId: "t1",
  scopes,
  deviceIds: null,
});

/** The route alone, as the v1 router mounts it, behind a stand-in for authentication. */
function appFor(route: V1Route, auth?: RequestAuth): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (auth !== undefined) setRequestAuth(req, auth);
    next();
  });
  const router = express.Router();
  router.route(route.expressPath)[route.spec.method]((req, res) => route.handle(ctx, req, res));
  app.use("/api/v1", router);
  app.use(createErrorHandler(logger));
  return app;
}

const itemParams = z.object({ id: z.uuid() });
const itemId = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";

const echo = defineRoute(
  {
    method: "post",
    path: "/api/v1/items/{id}/notes",
    operationId: "addNote",
    summary: "Add a note",
    description: "Echoes what it validated.",
    tags: ["Devices"],
    auth: { scopes: ["devices:write"] },
    request: {
      params: itemParams,
      query: z.object({ limit: z.coerce.number().int().max(10).default(5) }),
      body: z.object({ text: z.string().min(1) }),
    },
    responses: { 201: z.object({ id: z.uuid(), limit: z.number(), text: z.string() }) },
  },
  ({ params, query, body }) => ({
    status: 201,
    body: { id: params.id, limit: query.limit, text: body.text },
  }),
);

describe("route paths", () => {
  it("turns OpenAPI templates into Express paths", () => {
    expect(toExpressPath("/api/v1/devices/{id}/location")).toBe("/api/v1/devices/:id/location");
    expect(toExpressPath("/api/v1/segments/{segmentId}/mode/{at}")).toBe(
      "/api/v1/segments/:segmentId/mode/:at",
    );
    expect(toExpressPath("/api/v1/openapi.json")).toBe("/api/v1/openapi.json");
    expect(pathParameters("/api/v1/segments/{segmentId}/mode/{at}")).toEqual(["segmentId", "at"]);
    expect(echo.expressPath).toBe("/items/:id/notes");
  });

  it("refuses what Express would read differently than the document", () => {
    for (const template of [
      "/api/v1/items/{id",
      "/api/v1/items/:id",
      "/api/v1/items/{1d}",
      "/api/v1/items/(all)",
      "/api/v1/items/*",
      "/api/v1/items?x",
    ]) {
      expect(() => toExpressPath(template), template).toThrow(/Unsupported route path/);
    }
  });

  it("insists on one params key per path parameter", () => {
    const base = {
      method: "get",
      operationId: "getItem",
      summary: "Get an item",
      description: "",
      tags: ["Devices"],
      auth: "public",
      responses: { 204: null },
    } as const;
    expect(() =>
      defineRoute({ ...base, path: "/api/v1/items/{id}" }, () => ({ status: 204 })),
    ).toThrow(/path parameters \{id\}/);
    expect(() =>
      defineRoute(
        {
          ...base,
          path: "/api/v1/items/{id}",
          request: { params: z.object({ id: z.uuid(), other: z.string() }) },
        },
        () => ({ status: 204 }),
      ),
    ).toThrow(/need exactly these keys/);
    expect(() =>
      defineRoute({ ...base, path: "/api/v1/items", operationId: "Get-Item" }, () => ({
        status: 204,
      })),
    ).toThrow(/lowerCamelCase/);
  });
});

describe("validation", () => {
  it("hands the handler typed, validated input", async () => {
    const response = await request(appFor(echo, session))
      .post(`/api/v1/items/${itemId}/notes?limit=7`)
      .send({ text: "hello" })
      .expect(201);
    expect(response.body).toEqual({ id: itemId, limit: 7, text: "hello" });
  });

  it("answers 404 for path parameters that name nothing", async () => {
    const response = await request(appFor(echo, session))
      .post("/api/v1/items/not-a-uuid/notes")
      .send({ text: "hello" })
      .expect(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("answers 400 with the offending fields for a bad query or body", async () => {
    const app = appFor(echo, session);
    const query = await request(app)
      .post(`/api/v1/items/${itemId}/notes?limit=50`)
      .send({ text: "hello" })
      .expect(400);
    expect(query.body.error).toMatchObject({ code: "validation_failed" });
    expect(Object.keys(query.body.error.fields)).toEqual(["limit"]);
    const body = await request(app)
      .post(`/api/v1/items/${itemId}/notes`)
      .send({ text: "" })
      .expect(400);
    expect(Object.keys(body.body.error.fields)).toEqual(["text"]);
    const missing = await request(app).post(`/api/v1/items/${itemId}/notes`).expect(400);
    expect(missing.body.error.code).toBe("validation_failed");
  });

  it("answers 415 for a body that is not JSON", async () => {
    const response = await request(appFor(echo, session))
      .post(`/api/v1/items/${itemId}/notes`)
      .set("Content-Type", "text/plain")
      .send("text=hello")
      .expect(415);
    expect(response.body.error.code).toBe("bad_request");
  });
});

describe("authorization", () => {
  const scoped = (scopes: [ApiScope, ...ApiScope[]], all = false) =>
    defineRoute(
      {
        method: "get",
        path: "/api/v1/things",
        operationId: "listThings",
        summary: "List things",
        description: "",
        tags: ["Devices"],
        auth: all ? { scopes, all: true } : { scopes },
        responses: { 200: z.object({ kind: z.string() }) },
      },
      ({ auth }) => ({ status: 200, body: { kind: auth.kind } }),
    );

  it("asks for a credential when there is none", async () => {
    const response = await request(appFor(scoped(["devices:read"])))
      .get("/api/v1/things")
      .expect(401);
    expect(response.body.error.code).toBe("unauthorized");
    expect(response.headers["www-authenticate"]).toBe('Bearer realm="trail"');
  });

  it("lets a session through whatever the scopes", async () => {
    const route = scoped(["shares:write", "people:read"], true);
    const response = await request(appFor(route, session)).get("/api/v1/things").expect(200);
    expect(response.body).toEqual({ kind: "session" });
  });

  it("grants access with any one of the scopes", async () => {
    const route = scoped(["locations:read", "history:read"]);
    await request(appFor(route, token(["history:read"])))
      .get("/api/v1/things")
      .expect(200);
    const refused = await request(appFor(route, token(["devices:read"])))
      .get("/api/v1/things")
      .expect(403);
    expect(refused.body.error).toEqual({
      code: "insufficient_scope",
      message: "This API token needs one of the scopes locations:read, history:read.",
    });
    expect(refused.headers["www-authenticate"]).toBe(
      'Bearer realm="trail", error="insufficient_scope", scope="locations:read history:read"',
    );
  });

  it("needs every scope with all, and names the missing ones only", async () => {
    const route = scoped(["locations:read", "history:read"], true);
    await request(appFor(route, token(["history:read", "locations:read"])))
      .get("/api/v1/things")
      .expect(200);
    const refused = await request(appFor(route, token(["history:read"])))
      .get("/api/v1/things")
      .expect(403);
    expect(refused.body.error.message).toBe("This API token lacks the scope locations:read.");
    expect(refused.headers["www-authenticate"]).toContain('scope="locations:read"');
  });

  it("computes the missing scopes", () => {
    const rule = { scopes: ["devices:read", "locations:read"] } as const;
    expect(missingScopes(session, rule)).toEqual([]);
    expect(missingScopes(token(["locations:read"]), rule)).toEqual([]);
    expect(missingScopes(token([]), rule)).toEqual(["devices:read", "locations:read"]);
    expect(missingScopes(token(["devices:read"]), { ...rule, all: true })).toEqual([
      "locations:read",
    ]);
  });

  it("serves public routes with and without a principal", async () => {
    const route = defineRoute(
      {
        method: "get",
        path: "/api/v1/hello",
        operationId: "hello",
        summary: "Hello",
        description: "",
        tags: ["Reference"],
        auth: "public",
        responses: { 200: z.object({ who: z.string() }) },
      },
      ({ auth }) => ({ status: 200, body: { who: auth?.user.displayName ?? "anyone" } }),
    );
    expect((await request(appFor(route)).get("/api/v1/hello").expect(200)).body).toEqual({
      who: "anyone",
    });
    expect((await request(appFor(route, session)).get("/api/v1/hello").expect(200)).body).toEqual({
      who: "Jens",
    });
  });
});

describe("handler types", () => {
  it("are checked against the spec where the route is defined", () => {
    const spec = {
      method: "get",
      path: "/api/v1/count",
      operationId: "count",
      summary: "Count",
      description: "",
      tags: ["Reference"],
      auth: { scopes: ["devices:read"] },
      responses: { 200: z.object({ n: z.number() }) },
    } as const;
    defineRoute(spec, ({ auth, params, query, body }) => {
      // A scoped route always has a principal; parts the spec lacks are undefined.
      const id: string = auth.user.id;
      const none: undefined[] = [params, query, body];
      expect([id, none]).toBeDefined();
      return { status: 200, body: { n: 1 } };
    });
    // @ts-expect-error a status the spec does not list
    defineRoute(spec, () => ({ status: 201, body: { n: 1 } }));
    // @ts-expect-error a body that does not match its schema
    defineRoute(spec, () => ({ status: 200, body: { n: "one" } }));
    defineRoute({ ...spec, auth: "public" }, ({ auth }) => {
      // @ts-expect-error a public route may have no principal
      const id: string = auth.user.id;
      expect(id).toBeDefined();
      return { status: 200, body: { n: 0 } };
    });
  });
});

describe("responses", () => {
  const answering = (result: {
    status: 200 | 204;
    body?: unknown;
    headers?: Record<string, string>;
  }) =>
    defineRoute(
      {
        method: "get",
        path: "/api/v1/answer",
        operationId: "answer",
        summary: "Answer",
        description: "",
        tags: ["Reference"],
        auth: "public",
        responses: { 200: z.object({ name: z.string() }), 204: null },
      },
      // Untyped on purpose: these results test what the runtime does with a wrong one.
      () => result as { status: 200; body: { name: string } },
    );

  it("sends the body through its schema, so undocumented fields never leave", async () => {
    const route = answering({ status: 200, body: { name: "Phone", tokenHint: "x7Kq" } });
    const response = await request(appFor(route)).get("/api/v1/answer").expect(200);
    expect(response.body).toEqual({ name: "Phone" });
  });

  it("refuses a body that breaks its schema with a 500, without the result's headers", async () => {
    const route = answering({
      status: 200,
      body: { name: 42 },
      headers: { "Cache-Control": "public, max-age=300" },
    });
    const response = await request(appFor(route)).get("/api/v1/answer").expect(500);
    expect(response.body.error.code).toBe("internal");
    expect(response.headers["cache-control"]).toBeUndefined();
  });

  it("answers without a body where the spec says so, and with the handler's headers", async () => {
    const route = defineRoute(
      {
        method: "delete",
        path: "/api/v1/answer",
        operationId: "forget",
        summary: "Forget",
        description: "",
        tags: ["Reference"],
        auth: "public",
        responses: { 204: null },
      },
      () => ({ status: 204, headers: { "X-Forgotten": "yes" } }),
    );
    const response = await request(appFor(route)).delete("/api/v1/answer").expect(204);
    expect(response.text).toBe("");
    expect(response.headers["x-forgotten"]).toBe("yes");
  });
});
