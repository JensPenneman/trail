import { apiErrorSchema } from "@trail/contracts/errors";
import { sessionListResponseSchema } from "@trail/contracts/session";
import { sessionResponseSchema } from "@trail/contracts/user";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, agentFor, signInWithPasskey, signUp } from "../support/authFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;
const keys = new SoftwareAuthenticator();
let laptop: Agent;

const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  laptop = agentFor(t.app);
  await signUp(laptop, keys, "first@example.com");
});

afterAll(async () => {
  await t.close();
});

const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;

describe("sessions", () => {
  it("lists the user's browsers and revokes one", async () => {
    const phone = agentFor(t.app).set("User-Agent", iphone);
    await signInWithPasskey(phone, keys);

    const listed = await laptop.get("/api/me/sessions").expect(200);
    const { sessions } = sessionListResponseSchema.parse(listed.body);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    const phoneSession = sessions.find((session) => session.label === "Safari on iPhone");
    expect(phoneSession).toBeDefined();

    await laptop
      .delete(`/api/me/sessions/${phoneSession?.id ?? ""}`)
      .set("Origin", testOrigin)
      .expect(204);
    await phone.get("/api/auth/session").expect(401);
    await laptop
      .delete(`/api/me/sessions/${phoneSession?.id ?? ""}`)
      .set("Origin", testOrigin)
      .expect(404);
  });

  it("revokes every other session at once", async () => {
    const tablet = agentFor(t.app);
    await signInWithPasskey(tablet, keys);
    const remaining = await laptop
      .post("/api/me/sessions/revoke-others")
      .set("Origin", testOrigin)
      .expect(200);
    const { sessions } = sessionListResponseSchema.parse(remaining.body);
    expect(sessions.map((session) => session.current)).toEqual([true]);
    await tablet.get("/api/auth/session").expect(401);
    await laptop.get("/api/auth/session").expect(200);
  });

  it("slides the expiry forward, at most every five minutes", async () => {
    const quiet = await laptop.get("/api/auth/session").expect(200);
    expect(quiet.headers["set-cookie"]).toBeUndefined();

    await t.ctx.pool.query(
      "UPDATE sessions SET last_seen_at = now() - interval '10 minutes', expires_at = now() + interval '1 day'",
    );
    const refreshed = await laptop.get("/api/auth/session").expect(200);
    expect(String(refreshed.headers["set-cookie"])).toMatch(
      /^trail_session=[A-Za-z0-9_-]{43}; Max-Age=2592000;/,
    );
    const row = await t.ctx.pool.query<{ days: number }>(
      "SELECT extract(epoch FROM expires_at - now()) / 86400 AS days FROM sessions",
    );
    expect(Number(row.rows[0]?.days)).toBeGreaterThan(29.9);
  });

  it("clears the cookie of a session that no longer exists", async () => {
    const response = await agentFor(t.app)
      .get("/api/auth/session")
      .set("Cookie", `trail_session=${"z".repeat(43)}`)
      .expect(401);
    expect(String(response.headers["set-cookie"])).toContain("trail_session=; Max-Age=0");
  });
});

describe("CSRF protection", () => {
  it("requires an allowed Origin on unsafe requests", async () => {
    const missing = await laptop.post("/api/devices").send({ name: "Phone" }).expect(403);
    expect(errorCode(missing.body)).toBe("origin_not_allowed");
    const foreign = await laptop
      .post("/api/devices")
      .set("Origin", "https://evil.example")
      .send({ name: "Phone" })
      .expect(403);
    expect(errorCode(foreign.body)).toBe("origin_not_allowed");
    await laptop.post("/api/auth/logout").set("Origin", "null").expect(403);
  });

  it("rejects cross-site requests even from an allowed origin", async () => {
    const response = await laptop
      .post("/api/devices")
      .set("Origin", testOrigin)
      .set("Sec-Fetch-Site", "cross-site")
      .send({ name: "Phone" })
      .expect(403);
    expect(errorCode(response.body)).toBe("origin_not_allowed");
    await laptop
      .post("/api/devices")
      .set("Origin", testOrigin)
      .set("Sec-Fetch-Site", "same-origin")
      .send({ name: "Phone" })
      .expect(201);
  });

  it("only accepts JSON bodies (no form posts)", async () => {
    const response = await laptop
      .post("/api/devices")
      .set("Origin", testOrigin)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("name=Phone")
      .expect(415);
    expect(errorCode(response.body)).toBe("bad_request");
    const malformed = await laptop
      .post("/api/devices")
      .set("Origin", testOrigin)
      .set("Content-Type", "application/json")
      .send("{not json")
      .expect(400);
    expect(errorCode(malformed.body)).toBe("bad_request");
  });

  it("lets safe requests through without an Origin", async () => {
    await laptop.get("/api/me").expect(200);
  });

  it("limits dashboard bodies to 100 kB", async () => {
    const response = await laptop
      .post("/api/devices")
      .set("Origin", testOrigin)
      .send({ name: "x", padding: "y".repeat(120_000) })
      .expect(413);
    expect(errorCode(response.body)).toBe("payload_too_large");
  });
});

describe("profile and account", () => {
  it("updates the display name and time zone", async () => {
    const response = await laptop
      .patch("/api/me")
      .set("Origin", testOrigin)
      .send({ displayName: "Jens", timezone: "America/New_York" })
      .expect(200);
    expect(sessionResponseSchema.parse(response.body).user).toMatchObject({
      displayName: "Jens",
      timezone: "America/New_York",
    });
  });

  it("validates profile changes", async () => {
    const unknownZone = await laptop
      .patch("/api/me")
      .set("Origin", testOrigin)
      .send({ timezone: "Mars/Olympus" })
      .expect(400);
    expect(apiErrorSchema.parse(unknownZone.body).error.fields).toHaveProperty("timezone");
    await laptop.patch("/api/me").set("Origin", testOrigin).send({}).expect(400);
  });

  it("deletes the account only with the address retyped", async () => {
    const wrong = await laptop
      .delete("/api/me")
      .set("Origin", testOrigin)
      .send({ confirmEmail: "someone@example.com" })
      .expect(400);
    expect(apiErrorSchema.parse(wrong.body).error.fields).toHaveProperty("confirmEmail");
    await laptop
      .delete("/api/me")
      .set("Origin", testOrigin)
      .send({ confirmEmail: "First@Example.com" })
      .expect(204);
    await laptop.get("/api/auth/session").expect(401);
    const count = await t.ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
    expect(count.rows[0]?.n).toBe(0);
  });
});
