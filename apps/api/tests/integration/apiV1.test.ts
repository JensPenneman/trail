import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceResponseSchema } from "@trail/contracts/device";
import {
  deviceLocationResponseSchema,
  devicePublicListResponseSchema,
  devicePublicResponseSchema,
  devicePublicSchema,
} from "@trail/contracts/devicePublic";
import { apiErrorSchema } from "@trail/contracts/errors";
import { profileResponseSchema } from "@trail/contracts/profile";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v1Routes } from "../../src/v1/v1Routes";
import { type Agent, agentFor, signUp, signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { FakeApiTokens, tokenPrincipal, tokenSecret } from "../support/fakeApiTokens";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * `t` runs with the server's own token store, which knows none of the secrets
 * here; `withTokens` shares its database but resolves the tokens of a
 * FakeApiTokens, to try every outcome a verifier can have (tests/integration/
 * apiTokens.test.ts covers the store itself).
 */
let t: TestContext;
let withTokens: TestContext;
const tokens = new FakeApiTokens();
let owner: Agent;
let ownerCookie = "";
let stranger: Agent;
let uploaded = "";
let silent = "";
let foreign = "";

const ownerEmail = "first@example.com";
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;
const bearer = (secret: string) => `Bearer ${secret}`;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  withTokens = await createTestContext({ apiTokens: tokens });
  ({ agent: owner, cookie: ownerCookie } = await signUpWithCookie(t.app, ownerEmail));
  stranger = agentFor(t.app);
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");

  const phone = await createDevice(owner, { name: "Phone" });
  await postOverland(t.app, phone.credentials.accessToken, overlandFixture()).expect(200);
  uploaded = phone.device.id;
  silent = (await createDevice(owner, { name: "Watch" })).device.id;
  foreign = (await createDevice(stranger, { name: "Stranger's phone" })).device.id;
});

afterAll(async () => {
  await withTokens.close();
  await t.close();
});

const issue = async (
  options: { scopes: Parameters<typeof tokenPrincipal>[2]["scopes"]; deviceIds?: string[] | null },
  email = ownerEmail,
) => tokens.issue(await tokenPrincipal(withTokens.ctx.db, email, options));

const allScopes = ["profile:read", "devices:read", "locations:read"] as const;

describe("v1 with a signed-in session", () => {
  it("shows the account without its private details", async () => {
    const response = await owner.get(apiPaths.v1.me).expect(200);
    const { user } = profileResponseSchema.parse(response.body);
    expect(Object.keys(response.body.user).sort()).toEqual(["displayName", "id", "timezone"]);
    expect(user).toMatchObject({ displayName: "first", timezone: "Europe/Brussels" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("lists the devices without credentials or settings", async () => {
    const response = await owner.get(apiPaths.v1.devices.root).expect(200);
    const { devices } = devicePublicListResponseSchema.parse(response.body);
    expect(devices.map((device) => device.id)).toEqual([uploaded, silent]);
    for (const device of response.body.devices) {
      expect(Object.keys(device).sort()).toEqual(Object.keys(devicePublicSchema.shape).sort());
    }
    expect(JSON.stringify(response.body)).not.toMatch(/tokenHint|deviceKey|pendingSettings|alerts/);
    // A session holds every scope, positions included; null means no position yet.
    expect(devices.map((device) => device.lastLocation === null)).toEqual([false, true]);
    const one = await owner.get(apiPaths.v1.devices.one(uploaded)).expect(200);
    expect(devicePublicResponseSchema.parse(one.body).device).toEqual(devices[0]);
  });

  it("reports where a device is, from the same cache as the dashboard", async () => {
    const response = await owner.get(apiPaths.v1.devices.location(uploaded)).expect(200);
    const { location } = deviceLocationResponseSchema.parse(response.body);
    const summary = deviceResponseSchema.parse(
      (await owner.get(apiPaths.devices.one(uploaded)).expect(200)).body,
    ).device;
    expect(location).toEqual({
      deviceId: uploaded,
      ...summary.lastLocation,
      battery: summary.battery,
    });
    expect(location?.battery).not.toBeNull();
    const none = await owner.get(apiPaths.v1.devices.location(silent)).expect(200);
    expect(none.body).toEqual({ location: null });
  });

  it("answers 404 for other people's, unknown and malformed device ids", async () => {
    for (const path of [
      apiPaths.v1.devices.one(uploaded),
      apiPaths.v1.devices.location(uploaded),
      apiPaths.v1.devices.one("0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"),
      apiPaths.v1.devices.one("not-a-uuid"),
      apiPaths.v1.devices.location("not-a-uuid"),
    ]) {
      const response = await stranger.get(path).expect(404);
      expect(errorOf(response.body).code).toBe("not_found");
    }
  });

  it("asks for a credential when there is none", async () => {
    for (const path of [apiPaths.v1.me, apiPaths.v1.devices.root]) {
      const response = await request(t.app).get(path).expect(401);
      expect(errorOf(response.body).code).toBe("unauthorized");
      expect(response.headers["www-authenticate"]).toBe('Bearer realm="trail"');
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    }
  });
});

describe("v1 with API tokens", () => {
  it("refuses a token the store does not know, even next to a session cookie", async () => {
    const response = await request(t.app)
      .get(apiPaths.v1.me)
      .set("Authorization", bearer(tokenSecret()))
      .set("Cookie", ownerCookie)
      .expect(401);
    expect(errorOf(response.body).code).toBe("unauthorized");
    expect(response.headers["www-authenticate"]).toBe(
      'Bearer realm="trail", error="invalid_token"',
    );
  });

  it("serves the token's account and never reads the session cookie", async () => {
    const secret = await issue({ scopes: allScopes });
    const strangers = await signUpWithCookie(withTokens.app, "other@allowed.test");
    const response = await request(withTokens.app)
      .get(apiPaths.v1.me)
      .set("Authorization", bearer(secret))
      .set("Cookie", strangers.cookie)
      .expect(200);
    expect(profileResponseSchema.parse(response.body).user.displayName).toBe("first");
    // An unknown cookie would be cleared by the session middleware, which a bearer request skips.
    const unread = await request(withTokens.app)
      .get(apiPaths.v1.me)
      .set("Authorization", bearer(secret))
      .set("Cookie", `trail_session=${"x".repeat(43)}`)
      .expect(200);
    expect(unread.headers["set-cookie"]).toBeUndefined();
  });

  it("allows what a scope grants and names the scope that is missing", async () => {
    const secret = await issue({ scopes: ["devices:read"] });
    const listed = await request(withTokens.app)
      .get(apiPaths.v1.devices.root)
      .set("Authorization", bearer(secret))
      .expect(200);
    expect(devicePublicListResponseSchema.parse(listed.body).devices).toHaveLength(2);
    for (const [path, scope] of [
      [apiPaths.v1.me, "profile:read"],
      [apiPaths.v1.devices.location(uploaded), "locations:read"],
    ] as const) {
      const refused = await request(withTokens.app)
        .get(path)
        .set("Authorization", bearer(secret))
        .expect(403);
      expect(errorOf(refused.body)).toMatchObject({ code: "insufficient_scope" });
      expect(errorOf(refused.body).message).toContain(scope);
      expect(refused.headers["www-authenticate"]).toBe(
        `Bearer realm="trail", error="insufficient_scope", scope="${scope}"`,
      );
    }
  });

  it("shows where a device is only to a token with locations:read", async () => {
    const statusOnly = await issue({ scopes: ["devices:read"] });
    const withPositions = await issue({ scopes: ["devices:read", "locations:read"] });
    const get = (path: string, secret: string) =>
      request(withTokens.app).get(path).set("Authorization", bearer(secret)).expect(200);

    const withheld = await get(apiPaths.v1.devices.root, statusOnly);
    expect(devicePublicListResponseSchema.parse(withheld.body).devices).toHaveLength(2);
    for (const device of withheld.body.devices) expect(device).not.toHaveProperty("lastLocation");
    const one = (await get(apiPaths.v1.devices.one(uploaded), statusOnly)).body.device;
    expect(one).not.toHaveProperty("lastLocation");
    // What devices:read is for stays: status, last-seen time and battery.
    expect(one.lastSeenAt).not.toBeNull();
    expect(one.battery).not.toBeNull();

    const shown = devicePublicListResponseSchema.parse(
      (await get(apiPaths.v1.devices.root, withPositions)).body,
    ).devices;
    expect(shown[0]?.lastLocation).toMatchObject({
      lat: expect.any(Number),
      lon: expect.any(Number),
    });
    expect(shown[1]?.lastLocation).toBeNull();
  });

  it("keeps a token to its devices: the others do not exist for it", async () => {
    const secret = await issue({ scopes: allScopes, deviceIds: [uploaded] });
    const get = (path: string) =>
      request(withTokens.app).get(path).set("Authorization", bearer(secret));
    const listed = devicePublicListResponseSchema.parse(
      (await get(apiPaths.v1.devices.root).expect(200)).body,
    );
    expect(listed.devices.map((device) => device.id)).toEqual([uploaded]);
    await get(apiPaths.v1.devices.one(uploaded)).expect(200);
    await get(apiPaths.v1.devices.location(uploaded)).expect(200);
    for (const path of [
      apiPaths.v1.devices.one(silent),
      apiPaths.v1.devices.location(silent),
      apiPaths.v1.devices.one(foreign),
    ]) {
      expect(errorOf((await get(path).expect(404)).body).code).toBe("not_found");
    }
    const none = await issue({ scopes: allScopes, deviceIds: [] });
    const empty = await request(withTokens.app)
      .get(apiPaths.v1.devices.root)
      .set("Authorization", bearer(none))
      .expect(200);
    expect(empty.body).toEqual({ devices: [] });
  });

  it("never reaches another account's devices, even when a token names them", async () => {
    const secret = await issue({ scopes: allScopes, deviceIds: [foreign] });
    await request(withTokens.app)
      .get(apiPaths.v1.devices.one(foreign))
      .set("Authorization", bearer(secret))
      .expect(404);
    const listed = await request(withTokens.app)
      .get(apiPaths.v1.devices.root)
      .set("Authorization", bearer(secret))
      .expect(200);
    expect(listed.body).toEqual({ devices: [] });
  });

  it("refuses expired, revoked, address-bound and unknown tokens", async () => {
    const outcomes = [
      ["expired", "token_expired"],
      ["revoked", "unauthorized"],
      ["ip", "unauthorized"],
      ["unknown", "unauthorized"],
    ] as const;
    for (const [reason, code] of outcomes) {
      const response = await request(withTokens.app)
        .get(apiPaths.v1.devices.root)
        .set("Authorization", bearer(tokens.issue({ reason })))
        .expect(401);
      expect(errorOf(response.body).code, reason).toBe(code);
      expect(response.headers["www-authenticate"]).toBe(
        'Bearer realm="trail", error="invalid_token"',
      );
    }
  });

  it("is accepted under /api/v1 only: the dashboard's own routes never take a token", async () => {
    const secret = await issue({ scopes: allScopes });
    for (const path of [
      apiPaths.me.root,
      apiPaths.me.sessions,
      apiPaths.auth.session,
      apiPaths.devices.root,
      apiPaths.events,
    ]) {
      const response = await request(withTokens.app)
        .get(path)
        .set("Authorization", bearer(secret))
        .expect(401);
      expect(errorOf(response.body).code, path).toBe("unauthorized");
    }
  });

  it("refuses malformed credentials without a lookup", async () => {
    const before = tokens.calls.length;
    for (const header of [
      "Bearer not-a-token",
      `Bearer trl_${"A".repeat(43)}`,
      `Bearer ${tokenSecret()}x`,
      "Bearer",
      "bearer not-a-token",
    ]) {
      const response = await request(withTokens.app)
        .get(apiPaths.v1.me)
        .set("Authorization", header)
        .set("Cookie", ownerCookie)
        .expect(401);
      expect(errorOf(response.body).code, header).toBe("unauthorized");
      expect(response.headers["www-authenticate"], header).toBe(
        'Bearer realm="trail", error="invalid_token"',
      );
    }
    expect(tokens.calls.length).toBe(before);
  });

  it("reads the Bearer scheme only: another one is no API credential", async () => {
    const before = tokens.calls.length;
    const basic = "Basic Zmlyc3Q6c2VjcmV0";
    // A proxy in front may send credentials of its own: the session still decides.
    const signedIn = await request(withTokens.app)
      .get(apiPaths.v1.me)
      .set("Authorization", basic)
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(profileResponseSchema.parse(signedIn.body).user.displayName).toBe("first");
    // Without a session there is no credential at all, rather than a refused token.
    const anonymous = await request(withTokens.app)
      .get(apiPaths.v1.me)
      .set("Authorization", basic)
      .expect(401);
    expect(errorOf(anonymous.body).code).toBe("unauthorized");
    expect(anonymous.headers["www-authenticate"]).toBe('Bearer realm="trail"');
    // Still a session request, so the CSRF guard applies.
    const forged = await request(withTokens.app)
      .post(apiPaths.v1.devices.root)
      .set("Authorization", basic)
      .set("Cookie", ownerCookie)
      .set("Origin", "https://evil.example")
      .send({ name: "x" })
      .expect(403);
    expect(errorOf(forged.body).code).toBe("origin_not_allowed");
    expect(tokens.calls.length).toBe(before);
    // The scheme's name is case-insensitive.
    const secret = await issue({ scopes: allScopes });
    await request(withTokens.app)
      .get(apiPaths.v1.me)
      .set("Authorization", `bEaReR ${secret}`)
      .expect(200);
  });

  it("hands the verifier the client address that trust proxy settles on", async () => {
    const secret = await issue({ scopes: allScopes });
    await request(withTokens.app)
      .get(apiPaths.v1.me)
      .set("Authorization", bearer(secret))
      .set("X-Forwarded-For", "203.0.113.9")
      .expect(200);
    expect(tokens.calls.at(-1)).toEqual({ secret, ip: "203.0.113.9" });
  });
});

describe("v1 plumbing", () => {
  it("answers CORS preflights without credentials, the session or the token store", async () => {
    const before = tokens.calls.length;
    const response = await request(withTokens.app)
      .options(apiPaths.v1.devices.root)
      .set("Origin", "https://app.example")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization")
      .set("Authorization", bearer(tokenSecret()))
      .set("Cookie", `trail_session=${"x".repeat(43)}`)
      .expect(204);
    // The methods of the registry, in the order they first appear there.
    const methods = [
      ...new Set(
        v1Routes(() => {
          throw new Error("not served here");
        }).map(({ spec }) => spec.method.toUpperCase()),
      ),
    ].join(", ");
    expect(response.headers).toMatchObject({
      "access-control-allow-origin": "*",
      "access-control-allow-methods": methods,
      "access-control-allow-headers": "Authorization, Content-Type, Last-Event-ID",
      "access-control-max-age": "600",
    });
    // The methods of the registry; more arrive with new operations.
    expect(String(response.headers["access-control-allow-methods"]).split(", ")).toEqual(
      expect.arrayContaining(["GET", "PATCH"]),
    );
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(tokens.calls.length).toBe(before);
  });

  it("exposes the headers a browser client needs", async () => {
    const response = await request(t.app).get(apiPaths.v1.me).set("Origin", "https://app.example");
    expect(response.headers["access-control-expose-headers"]).toBe(
      "ETag, RateLimit, RateLimit-Policy, Retry-After, WWW-Authenticate, X-Request-Id",
    );
    expect(String(response.headers["ratelimit-policy"])).toContain('"ip"');
  });

  it("answers unknown v1 routes with a JSON 404", async () => {
    for (const path of ["/api/v1/nope", "/api/v1", "/api/v1/devices/a/b/c"]) {
      const response = await request(t.app).get(path).expect(404);
      expect(errorOf(response.body)).toEqual({ code: "not_found", message: "No such API route." });
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    }
  });

  it("guards session requests against CSRF but not token requests", async () => {
    const forged = await owner
      .post(apiPaths.v1.devices.root)
      .set("Origin", "https://evil.example")
      .send({ name: "x" })
      .expect(403);
    expect(errorOf(forged.body).code).toBe("origin_not_allowed");
    await owner.post(apiPaths.v1.devices.root).set("Origin", testOrigin).send({}).expect(404);
    const secret = await issue({ scopes: allScopes });
    await request(withTokens.app)
      .post(apiPaths.v1.devices.root)
      .set("Authorization", bearer(secret))
      .set("Origin", "https://evil.example")
      .send({ name: "x" })
      .expect(404);
  });

  it("limits request bodies to 100 kB", async () => {
    const secret = await issue({ scopes: allScopes });
    const response = await request(withTokens.app)
      .post("/api/v1/nope")
      .set("Authorization", bearer(secret))
      .send({ padding: "x".repeat(120_000) })
      .expect(413);
    expect(errorOf(response.body).code).toBe("payload_too_large");
  });
});

describe("v1 rate limits", () => {
  it("limits refused tokens per address, never a valid token", async () => {
    const own = new FakeApiTokens();
    const limited = await createTestContext({
      apiTokens: own,
      env: { RATE_LIMIT_TOKEN_FAILED_PER_10_MINUTES: "2" },
    });
    try {
      const valid = own.issue(
        await tokenPrincipal(limited.ctx.db, ownerEmail, { scopes: allScopes }),
      );
      const guess = () =>
        request(limited.app).get(apiPaths.v1.me).set("Authorization", bearer(tokenSecret()));
      await guess().expect(401);
      await guess().expect(401);
      const blocked = await guess().expect(429);
      expect(errorOf(blocked.body).code).toBe("rate_limited");
      expect(blocked.headers["retry-after"]).toBeDefined();
      expect(blocked.headers["access-control-allow-origin"]).toBe("*");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await request(limited.app)
          .get(apiPaths.v1.me)
          .set("Authorization", bearer(valid))
          .expect(200);
      }
      await guess().expect(429);
    } finally {
      await limited.close();
    }
  });

  it("limits each token on its own, and not sessions", async () => {
    const own = new FakeApiTokens();
    const limited = await createTestContext({
      apiTokens: own,
      env: { RATE_LIMIT_TOKEN_PER_MINUTE: "2" },
    });
    try {
      const principal = () => tokenPrincipal(limited.ctx.db, ownerEmail, { scopes: allScopes });
      const first = own.issue(await principal());
      const second = own.issue(await principal());
      const call = (secret: string) =>
        request(limited.app).get(apiPaths.v1.me).set("Authorization", bearer(secret));
      const allowed = await call(first).expect(200);
      expect(String(allowed.headers["ratelimit"])).toMatch(/"token"; r=1;/);
      await call(first).expect(200);
      const blocked = await call(first).expect(429);
      expect(errorOf(blocked.body).code).toBe("rate_limited");
      await call(second).expect(200);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const session = await request(limited.app)
          .get(apiPaths.v1.me)
          .set("Cookie", ownerCookie)
          .expect(200);
        expect(String(session.headers["ratelimit"])).not.toContain('"token"');
      }
    } finally {
      await limited.close();
    }
  });
});
