import type { ApiScope } from "@trail/contracts/apiScope";
import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AppContext } from "../../src/appContext";
import { type RequestAuth, setRequestAuth, type UserRow } from "../../src/auth/requestAuth";
import type { AccessRecord } from "../../src/dataAccess/accessRecord";
import { createErrorHandler } from "../../src/http/errorHandler";
import { HttpError } from "../../src/http/httpError";
import { createLogger } from "../../src/logging/createLogger";
import { defineRoute, missingScopes, type V1Route } from "../../src/v1/defineRoute";
import { pathParameters, toExpressPath } from "../../src/v1/toExpressPath";

const logger = createLogger({ level: "silent" });
/** What the routes below record in the data access log. */
const recorded: AccessRecord[] = [];
let recordFails = false;
// The handlers below never touch the context; the route hands it through and records into it.
const ctx = {
  logger,
  dataAccess: {
    record: (access: AccessRecord) => {
      if (recordFails) throw new Error("the log is broken");
      recorded.push(access);
    },
  },
} as unknown as AppContext;

const user: UserRow = {
  id: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60",
  email: "jens@example.com",
  displayName: "Jens",
  webauthnUserId: Buffer.alloc(32),
  isAdmin: false,
  timezone: "Europe/Brussels",
  preferences: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const session: RequestAuth = { kind: "session", user, sessionId: "s".repeat(64) };
const token = (scopes: ApiScope[]): RequestAuth => ({
  kind: "token",
  user,
  tokenId: "t1",
  tokenName: "Script",
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

  it("refuses a public route that takes a body (it runs before the body parser)", () => {
    expect(() =>
      defineRoute(
        {
          method: "post",
          path: "/api/v1/items",
          operationId: "addItem",
          summary: "Add an item",
          description: "",
          tags: ["Devices"],
          auth: "public",
          request: { body: z.object({ name: z.string() }) },
          responses: { 204: null },
        },
        () => ({ status: 204 }),
      ),
    ).toThrow(/addItem is public and takes a body/);
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
    expect(response.body.error).toEqual({
      code: "unauthorized",
      message: "Sign in, or send an API token as Authorization: Bearer trlk_…",
    });
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

  it("serves a route for the whole account to sessions and tokens for every device only", async () => {
    const route = defineRoute(
      {
        method: "get",
        path: "/api/v1/whole",
        operationId: "wholeAccount",
        summary: "Whole account",
        description: "",
        tags: ["Profile"],
        auth: { scopes: ["audit:read"], allDevices: true },
        responses: { 200: z.object({}) },
        access: false,
      },
      () => ({ status: 200, body: {} }),
    );
    await request(appFor(route, session)).get("/api/v1/whole").expect(200);
    await request(appFor(route, token(["audit:read"])))
      .get("/api/v1/whole")
      .expect(200);
    const limited = { ...token(["audit:read"]), deviceIds: [itemId] } as RequestAuth;
    const refused = await request(appFor(route, limited)).get("/api/v1/whole").expect(403);
    expect(refused.body.error.code).toBe("insufficient_scope");
    expect(refused.body.error.message).toContain("every device");
    expect(refused.headers["www-authenticate"]).toBe(
      'Bearer realm="trail", error="insufficient_scope", scope="audit:read"',
    );
  });

  it("serves token routes to any API token, refuses sessions with a 400", async () => {
    const route = defineRoute(
      {
        method: "get",
        path: "/api/v1/whoami",
        operationId: "whoAmI",
        summary: "Who am I",
        description: "",
        tags: ["Reference"],
        auth: "token",
        responses: { 200: z.object({ tokenId: z.string() }) },
      },
      ({ auth }) => ({ status: 200, body: { tokenId: auth.tokenId } }),
    );
    const allowed = await request(appFor(route, token(["profile:read"])))
      .get("/api/v1/whoami")
      .expect(200);
    expect(allowed.body).toEqual({ tokenId: "t1" });
    const refused = await request(appFor(route, session)).get("/api/v1/whoami").expect(400);
    expect(refused.body.error.code).toBe("bad_request");
    expect(refused.body.error.message).toContain("Authorization: Bearer");
    const anonymous = await request(appFor(route)).get("/api/v1/whoami").expect(401);
    expect(anonymous.body.error).toEqual({
      code: "unauthorized",
      message: "Send an API token as Authorization: Bearer trlk_…",
    });
    expect(anonymous.headers["www-authenticate"]).toBe('Bearer realm="trail"');
  });

  it("serves public routes with and without a token's principal", async () => {
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
    // In the real router a public route never sees a session (createV1Router loads none for it).
    const withToken = appFor(route, token(["profile:read"]));
    expect((await request(withToken).get("/api/v1/hello").expect(200)).body).toEqual({
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
    defineRoute({ ...spec, auth: "token" }, ({ auth }) => {
      // A token route always has a token principal, with the token's own id.
      const tokenId: string = auth.tokenId;
      expect(tokenId).toBeDefined();
      return { status: 200, body: { n: 2 } };
    });
    defineRoute(spec, ({ auth }) => {
      // @ts-expect-error a scoped route may be a session, which has no token id
      const tokenId: string = auth.tokenId;
      expect(tokenId).toBeDefined();
      return { status: 200, body: { n: 3 } };
    });
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

describe("the data access log", () => {
  const ownerId = user.id;
  const probe = defineRoute(
    {
      method: "get",
      path: "/api/v1/devices/{id}/probe",
      operationId: "probeDevice",
      summary: "Probe a device",
      description: "Answers what it was asked.",
      tags: ["Devices"],
      auth: { scopes: ["devices:read"] },
      request: {
        params: itemParams,
        query: z.object({
          from: z.iso.datetime({ offset: true }).optional(),
          name: z.string().optional(),
          fail: z.enum(["409", "500"]).optional(),
        }),
      },
      responses: { 200: z.object({ ok: z.boolean() }) },
    },
    ({ query }) => {
      if (query.fail === "409") throw new HttpError(409, "conflict", "No.");
      // A body its schema refuses: the answer is a 500, which is no access.
      if (query.fail === "500") return { status: 200, body: { ok: "yes" as unknown as boolean } };
      return { status: 200, body: { ok: true } };
    },
  );
  const fresh = () => {
    recorded.length = 0;
    recordFails = false;
  };

  it("records a scoped route's answer for the caller once it went out", async () => {
    fresh();
    await request(appFor(probe, session))
      .get(`/api/v1/devices/${itemId}/probe?from=2026-10-26T10:00:00%2B02:00&name=Home`)
      .set(
        "User-Agent",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1",
      )
      .expect(200);
    expect(recorded).toEqual([
      {
        action: "probeDevice",
        access: "read",
        status: 200,
        channel: "web",
        actor: { kind: "owner", sessionId: "s".repeat(64), label: "Safari on iPhone" },
        ownerUserId: ownerId,
        // The path's device and the range; the name is no part of what was read.
        resource: { deviceIds: [itemId], from: "2026-10-26T08:00:00.000Z" },
      },
    ]);
  });

  it("names a token by its name, on the api channel", async () => {
    fresh();
    await request(appFor(probe, token(["devices:read"])))
      .get(`/api/v1/devices/${itemId}/probe`)
      .expect(200);
    expect(recorded).toMatchObject([
      { channel: "api", actor: { kind: "token", tokenId: "t1", label: "Script" } },
    ]);
  });

  it("records nothing for a refusal, a failure or an invalid request", async () => {
    fresh();
    await request(appFor(probe)).get(`/api/v1/devices/${itemId}/probe`).expect(401);
    await request(appFor(probe, token(["locations:read"])))
      .get(`/api/v1/devices/${itemId}/probe`)
      .expect(403);
    await request(appFor(probe, session)).get("/api/v1/devices/nope/probe").expect(404);
    await request(appFor(probe, session))
      .get(`/api/v1/devices/${itemId}/probe?from=yesterday`)
      .expect(400);
    await request(appFor(probe, session))
      .get(`/api/v1/devices/${itemId}/probe?fail=409`)
      .expect(409);
    await request(appFor(probe, session))
      .get(`/api/v1/devices/${itemId}/probe?fail=500`)
      .expect(500);
    expect(recorded).toEqual([]);
  });

  it("never fails an answer when the log fails", async () => {
    fresh();
    recordFails = true;
    const answer = await request(appFor(probe, session)).get(`/api/v1/devices/${itemId}/probe`);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ ok: true });
  });

  it("takes the kind from the method unless the spec names it, and adds what the answer names", async () => {
    fresh();
    const write = defineRoute(
      {
        method: "post",
        path: "/api/v1/share-links",
        operationId: "makeProbe",
        summary: "Make",
        description: "",
        tags: ["Sharing"],
        auth: { scopes: ["shares:write"] },
        request: { body: z.object({ precision: z.enum(["precise", "area"]), label: z.string() }) },
        responses: { 201: z.object({ id: z.uuid() }) },
      },
      () => ({ status: 201, body: { id: itemId }, resource: { linkId: itemId } }),
    );
    const exported = defineRoute(
      {
        method: "get",
        path: "/api/v1/stats/days",
        operationId: "exportProbe",
        summary: "Export",
        description: "",
        tags: ["History"],
        auth: { scopes: ["history:read"] },
        responses: { 200: z.object({}) },
        access: { kind: "export" },
      },
      () => ({ status: 200, body: {} }),
    );
    await request(appFor(write, session))
      .post("/api/v1/share-links")
      .send({ precision: "area", label: "Typed by the caller" })
      .expect(201);
    await request(appFor(exported, session)).get("/api/v1/stats/days").expect(200);
    expect(recorded).toMatchObject([
      {
        action: "makeProbe",
        access: "write",
        status: 201,
        resource: { precision: "area", linkId: itemId },
      },
      { action: "exportProbe", access: "export", resource: {} },
    ]);
    expect(JSON.stringify(recorded)).not.toContain("Typed by the caller");
  });

  it("records nothing for a route that opts out, a token route or a public one", async () => {
    fresh();
    const quiet = defineRoute(
      {
        method: "get",
        path: "/api/v1/quiet",
        operationId: "quietProbe",
        summary: "Quiet",
        description: "",
        tags: ["Reference"],
        auth: { scopes: ["audit:read"] },
        responses: { 200: z.object({}) },
        access: false,
      },
      () => ({ status: 200, body: {} }),
    );
    const own = defineRoute(
      {
        method: "get",
        path: "/api/v1/self",
        operationId: "selfProbe",
        summary: "Self",
        description: "",
        tags: ["Tokens"],
        auth: "token",
        responses: { 200: z.object({}) },
      },
      () => ({ status: 200, body: {} }),
    );
    const open = defineRoute(
      {
        method: "get",
        path: "/api/v1/open",
        operationId: "openProbe",
        summary: "Open",
        description: "",
        tags: ["Reference"],
        auth: "public",
        responses: { 200: z.object({}) },
      },
      () => ({ status: 200, body: {} }),
    );
    await request(appFor(quiet, session)).get("/api/v1/quiet").expect(200);
    await request(appFor(own, token([])))
      .get("/api/v1/self")
      .expect(200);
    await request(appFor(open, token([])))
      .get("/api/v1/open")
      .expect(200);
    expect(recorded).toEqual([]);
  });

  it("records a people route for the owners it names, never for the caller", async () => {
    fresh();
    const alice = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a70";
    const bob = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a71";
    const shareOfAlice = "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23";
    const people = defineRoute(
      {
        method: "get",
        path: "/api/v1/people",
        operationId: "peopleProbe",
        summary: "People",
        description: "",
        tags: ["People"],
        auth: { scopes: ["people:read"] },
        responses: { 200: z.object({ count: z.number() }) },
        access: { people: true },
      },
      () => ({
        status: 200,
        body: { count: 2 },
        owners: [
          {
            ownerUserId: alice,
            shareId: shareOfAlice,
            resource: { deviceIds: [itemId], precision: "area" },
          },
          { ownerUserId: bob, shareId: null, resource: {} },
        ],
      }),
    );
    await request(appFor(people, token(["people:read"])))
      .get("/api/v1/people")
      .expect(200);
    expect(recorded).toEqual([
      {
        action: "peopleProbe",
        access: "read",
        status: 200,
        ownerUserId: alice,
        channel: "people",
        // The person, whatever credential they came with: no token, no session, no browser.
        actor: { kind: "person", userId: ownerId, shareId: shareOfAlice, label: "Jens" },
        resource: { deviceIds: [itemId], precision: "area" },
      },
      {
        action: "peopleProbe",
        access: "read",
        status: 200,
        ownerUserId: bob,
        channel: "people",
        actor: { kind: "person", userId: ownerId, shareId: null, label: "Jens" },
        resource: {},
      },
    ]);
  });

  it("refuses a spec that would count a route without scopes", () => {
    expect(() =>
      defineRoute(
        {
          method: "get",
          path: "/api/v1/nothing",
          operationId: "nothingProbe",
          summary: "Nothing",
          description: "",
          tags: ["Reference"],
          auth: "public",
          responses: { 200: z.object({}) },
          access: { kind: "read" },
        },
        () => ({ status: 200, body: {} }),
      ),
    ).toThrow(/data access log/);
  });
});
