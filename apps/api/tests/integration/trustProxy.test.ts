import { sessionListResponseSchema } from "@trail/contracts/session";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * X-Forwarded-For decides the client address of the per-IP rate limits and of
 * the session list, X-Forwarded-Proto whether a request counts as HTTPS. Only a
 * configured proxy may set them: by default nobody is trusted, so a client on
 * the LAN cannot dodge the limits by inventing a new address per request. The
 * test requests come from 127.0.0.1; TRUST_PROXY empty means the default.
 */
let limited: TestContext;
let untrusted: TestContext;
let trusted: TestContext;

beforeAll(async () => {
  await resetDatabase();
  limited = await createTestContext({ env: { TRUST_PROXY: "", RATE_LIMIT_AUTH_PER_MINUTE: "2" } });
  untrusted = await createTestContext({ env: { TRUST_PROXY: "" } });
  trusted = await createTestContext({ env: { TRUST_PROXY: "loopback" } });
});

afterAll(async () => {
  await limited.close();
  await untrusted.close();
  await trusted.close();
});

const sessionIp = async (agent: Agent): Promise<string | null> => {
  const response = await agent.get("/api/me/sessions").expect(200);
  return sessionListResponseSchema.parse(response.body).sessions[0]?.ip ?? null;
};

describe("forwarded headers", () => {
  it("are ignored from a peer that is not a configured proxy", async () => {
    for (const address of ["198.51.100.1", "198.51.100.2"]) {
      await request(limited.app)
        .post("/api/auth/passkey")
        .set("Origin", testOrigin)
        .set("X-Forwarded-For", address)
        .expect(200);
    }
    // A made-up address per request buys no fresh budget.
    await request(limited.app)
      .post("/api/auth/passkey")
      .set("Origin", testOrigin)
      .set("X-Forwarded-For", "198.51.100.3")
      .expect(429);

    const agent = agentFor(untrusted.app).set("X-Forwarded-For", "198.51.100.4");
    await signUp(agent, new SoftwareAuthenticator(), "first@example.com");
    expect(await sessionIp(agent)).toMatch(/^(::ffff:)?127\.0\.0\.1$/);

    const pretendHttps = await request(untrusted.app)
      .get("/api/config")
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    expect(pretendHttps.headers["strict-transport-security"]).toBeUndefined();
  });

  it("give the client address and the protocol behind a configured proxy", async () => {
    const agent = agentFor(trusted.app).set("X-Forwarded-For", "203.0.113.7");
    await signUp(agent, new SoftwareAuthenticator(), "second@allowed.test");
    expect(await sessionIp(agent)).toBe("203.0.113.7");

    const https = await request(trusted.app)
      .get("/api/config")
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    expect(https.headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
  });
});
