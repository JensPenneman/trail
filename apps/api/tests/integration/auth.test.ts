import { passkeyOptionsResponseSchema, startAuthResponseSchema } from "@trail/contracts/auth";
import { apiErrorSchema } from "@trail/contracts/errors";
import { sessionResponseSchema } from "@trail/contracts/user";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { passkeys } from "../../src/db/schema/passkeys";
import { agentFor, signIn, signInWithPasskey, signUp } from "../support/authFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { otherOrigin, testOrigin } from "../support/testEnvironment";

let t: TestContext;
const authenticator = new SoftwareAuthenticator();

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
});

afterAll(async () => {
  await t.close();
});

const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;

describe("sign-up", () => {
  it("creates the first account as admin, with a session cookie", async () => {
    const agent = agentFor(t.app);
    const started = await agent
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "  First@Example.com " })
      .expect(200);
    const start = startAuthResponseSchema.parse(started.body);
    expect(start.flow).toBe("register");
    if (start.flow !== "register") return;
    expect(start.options.rp).toEqual({ name: "Trail", id: "localhost" });
    expect(start.options.user.name).toBe("first@example.com");
    expect(start.options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    expect(start.options.attestation).toBe("none");
    expect(start.options.pubKeyCredParams.map((param) => param.alg)).toEqual([-8, -7, -257]);

    const finished = await agent
      .post("/api/auth/finish")
      .set("Origin", testOrigin)
      .send({
        ceremonyId: start.ceremonyId,
        response: authenticator.createCredential(start.options, testOrigin),
      })
      .expect(200);
    expect(finished.body).toMatchObject({
      created: true,
      user: {
        email: "first@example.com",
        displayName: "first",
        isAdmin: true,
        timezone: "Europe/Brussels",
      },
    });
    const cookie = String(finished.headers["set-cookie"]);
    expect(cookie).toMatch(
      /^trail_session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax/,
    );
    expect(cookie).not.toContain("Secure");

    const session = await agent.get("/api/auth/session").expect(200);
    expect(sessionResponseSchema.parse(session.body).user.email).toBe("first@example.com");
  });

  it("does not make later accounts admin (domain allow-list)", async () => {
    const result = await signUp(
      agentFor(t.app),
      new SoftwareAuthenticator(),
      "second@allowed.test",
    );
    expect(result.user.isAdmin).toBe(false);
  });

  it("refuses addresses that are neither allow-listed nor invited", async () => {
    const response = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "stranger@elsewhere.test" })
      .expect(403);
    expect(errorCode(response.body)).toBe("signup_not_allowed");
  });

  it("validates the request body", async () => {
    const response = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "not an address" })
      .expect(400);
    const body = apiErrorSchema.parse(response.body);
    expect(body.error.code).toBe("validation_failed");
    expect(Object.keys(body.error.fields ?? {})).toEqual(["email"]);
  });
});

describe("sign-in", () => {
  it("offers only this RP ID's passkeys for an existing account and signs in", async () => {
    const agent = agentFor(t.app);
    const result = await signIn(agent, authenticator, "first@example.com");
    expect(result).toMatchObject({ created: false, user: { email: "first@example.com" } });
    await agent.get("/api/auth/session").expect(200);
    const credentialId = authenticator.credentials[0]?.id.toString("base64url") ?? "";
    const [stored] = await t.ctx.db.select().from(passkeys).where(eq(passkeys.id, credentialId));
    expect(stored?.counter).toBeGreaterThan(0);
    expect(stored?.lastUsedAt).not.toBeNull();
  });

  it("signs in without an email through a discoverable passkey", async () => {
    const agent = agentFor(t.app);
    const result = await signInWithPasskey(agent, authenticator);
    expect(result.user.email).toBe("first@example.com");
  });

  it("uses each ceremony only once", async () => {
    const agent = agentFor(t.app);
    const started = await agent.post("/api/auth/passkey").set("Origin", testOrigin).expect(200);
    const start = passkeyOptionsResponseSchema.parse(started.body);
    const response = authenticator.getAssertion(start.options, testOrigin);
    await agent
      .post("/api/auth/finish")
      .set("Origin", testOrigin)
      .send({ ceremonyId: start.ceremonyId, response })
      .expect(200);
    const replay = await agent
      .post("/api/auth/finish")
      .set("Origin", testOrigin)
      .send({ ceremonyId: start.ceremonyId, response })
      .expect(400);
    expect(errorCode(replay.body)).toBe("ceremony_expired");
  });

  it("rejects ceremonies from origins that are not allowed", async () => {
    const response = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", "https://evil.example")
      .send({ email: "first@example.com" })
      .expect(403);
    expect(errorCode(response.body)).toBe("origin_not_allowed");
  });

  it("rejects an assertion made on another origin (clientDataJSON)", async () => {
    const agent = agentFor(t.app);
    const started = await agent
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "first@example.com" })
      .expect(200);
    const start = startAuthResponseSchema.parse(started.body);
    if (start.flow !== "authenticate") throw new Error("expected a sign-in");
    const response = authenticator.getAssertion(start.options, testOrigin, {
      clientOrigin: "http://localhost:6666",
    });
    const finished = await agent
      .post("/api/auth/finish")
      .set("Origin", testOrigin)
      .send({ ceremonyId: start.ceremonyId, response })
      .expect(400);
    expect(errorCode(finished.body)).toBe("webauthn_failed");
    await agent.get("/api/auth/session").expect(401);
  });

  it("rejects finishing on a different origin than where the ceremony started", async () => {
    const agent = agentFor(t.app);
    const started = await agent.post("/api/auth/passkey").set("Origin", testOrigin).expect(200);
    const start = passkeyOptionsResponseSchema.parse(started.body);
    const finished = await agent
      .post("/api/auth/finish")
      .set("Origin", otherOrigin)
      .send({
        ceremonyId: start.ceremonyId,
        response: authenticator.getAssertion(start.options, testOrigin),
      })
      .expect(403);
    expect(errorCode(finished.body)).toBe("origin_not_allowed");
  });

  it("detects a cloned authenticator by its signature counter", async () => {
    const clone = authenticator.credentials[0];
    if (clone === undefined) throw new Error("no credential");
    clone.counter = 0;
    const agent = agentFor(t.app);
    const started = await agent.post("/api/auth/passkey").set("Origin", testOrigin).expect(200);
    const start = passkeyOptionsResponseSchema.parse(started.body);
    const finished = await agent
      .post("/api/auth/finish")
      .set("Origin", testOrigin)
      .send({
        ceremonyId: start.ceremonyId,
        response: authenticator.getAssertion(start.options, testOrigin),
      })
      .expect(400);
    expect(errorCode(finished.body)).toBe("webauthn_failed");
    clone.counter = 1000;
  });

  it("answers unknown_credential for a passkey the server does not know", async () => {
    const stranger = new SoftwareAuthenticator();
    stranger.createCredential(
      {
        rp: { name: "Trail", id: "localhost" },
        user: { id: Buffer.from("someone").toString("base64url"), name: "x", displayName: "x" },
        challenge: "unused",
        pubKeyCredParams: [],
      },
      testOrigin,
    );
    const agent = agentFor(t.app);
    const started = await agent.post("/api/auth/passkey").set("Origin", testOrigin).expect(200);
    const start = passkeyOptionsResponseSchema.parse(started.body);
    const finished = await agent
      .post("/api/auth/finish")
      .set("Origin", testOrigin)
      .send({
        ceremonyId: start.ceremonyId,
        response: stranger.getAssertion(start.options, testOrigin),
      })
      .expect(401);
    expect(errorCode(finished.body)).toBe("unknown_credential");
  });

  it("tells the user when the account has no passkey for this origin", async () => {
    const response = await agentFor(t.app)
      .post("/api/auth/start")
      .set("Origin", otherOrigin)
      .send({ email: "first@example.com" })
      .expect(409);
    expect(errorCode(response.body)).toBe("no_passkey_for_origin");
  });

  it("rejects a registration answering a different challenge", async () => {
    const agent = agentFor(t.app);
    const started = await agent
      .post("/api/auth/start")
      .set("Origin", testOrigin)
      .send({ email: "third@allowed.test" })
      .expect(200);
    const start = startAuthResponseSchema.parse(started.body);
    if (start.flow !== "register") throw new Error("expected a registration");
    const response = new SoftwareAuthenticator().createCredential(start.options, testOrigin, {
      challenge: "c29tZXRoaW5nLWVsc2U",
    });
    const finished = await agent
      .post("/api/auth/finish")
      .set("Origin", testOrigin)
      .send({ ceremonyId: start.ceremonyId, response })
      .expect(400);
    expect(errorCode(finished.body)).toBe("webauthn_failed");
  });
});

describe("session", () => {
  it("is 401 without a cookie", async () => {
    const response = await agentFor(t.app).get("/api/auth/session").expect(401);
    expect(errorCode(response.body)).toBe("unauthorized");
  });

  it("ends with logout", async () => {
    const agent = agentFor(t.app);
    await signInWithPasskey(agent, authenticator);
    const logout = await agent.post("/api/auth/logout").set("Origin", testOrigin).expect(204);
    expect(String(logout.headers["set-cookie"])).toContain("trail_session=; Max-Age=0");
    await agent.get("/api/auth/session").expect(401);
  });

  it("uses the __Host- cookie on HTTPS and ignores the plain one there", async () => {
    const agent = agentFor(t.app);
    const started = await agent
      .post("/api/auth/passkey")
      .set("Origin", testOrigin)
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    const start = passkeyOptionsResponseSchema.parse(started.body);
    const finished = await agent
      .post("/api/auth/finish")
      .set("Origin", testOrigin)
      .set("X-Forwarded-Proto", "https")
      .send({
        ceremonyId: start.ceremonyId,
        response: authenticator.getAssertion(start.options, testOrigin),
      })
      .expect(200);
    const cookie = String(finished.headers["set-cookie"]);
    expect(cookie).toMatch(
      /^__Host-trail_session=[A-Za-z0-9_-]{43}; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    const token = /=([A-Za-z0-9_-]{43});/.exec(cookie)?.[1] ?? "";
    await agentFor(t.app)
      .get("/api/auth/session")
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", `__Host-trail_session=${token}`)
      .expect(200);
    await agentFor(t.app)
      .get("/api/auth/session")
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", `trail_session=${token}`)
      .expect(401);
  });

  it("stores only the SHA-256 of session tokens", async () => {
    const rows = await t.ctx.pool.query<{ id: string }>("SELECT id FROM sessions");
    for (const row of rows.rows) expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await t.ctx.db.select().from(passkeys).where(eq(passkeys.rpId, "localhost")),
    ).not.toHaveLength(0);
  });
});
