import { apiErrorSchema } from "@trail/contracts/errors";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({
    env: {
      RATE_LIMIT_AUTH_PER_MINUTE: "3",
      RATE_LIMIT_API_PER_MINUTE: "8",
      RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES: "2",
    },
  });
});

afterAll(async () => {
  await t.close();
});

describe("rate limits", () => {
  it("limits auth ceremonies per IP", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(t.app).post("/api/auth/passkey").set("Origin", testOrigin).expect(200);
    }
    const limited = await request(t.app)
      .post("/api/auth/passkey")
      .set("Origin", testOrigin)
      .expect(429);
    expect(apiErrorSchema.parse(limited.body).error.code).toBe("rate_limited");
    expect(limited.headers["ratelimit-policy"]).toBeDefined();
  });

  it("limits the database health check per IP, but never the liveness probe", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await request(t.app).get("/api/health").expect(200);
    }
    const limited = await request(t.app).get("/api/health").expect(429);
    expect(apiErrorSchema.parse(limited.body).error.code).toBe("rate_limited");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(t.app).get("/api/health/live").expect(200);
    }
  });

  it("limits failed device tokens per IP in Overland's error format", async () => {
    const bad = `trl_${"B".repeat(43)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(t.app)
        .post("/api/overland")
        .set("Authorization", `Bearer ${bad}`)
        .send({})
        .expect(401);
    }
    const limited = await request(t.app)
      .post("/api/overland")
      .set("Authorization", `Bearer ${bad}`)
      .send({})
      .expect(429);
    expect(typeof limited.body.error).toBe("string");
  });

  it("never locks a valid device token out because of failed ones from the same address", async () => {
    // Behind NAT or a reverse proxy every phone and every scanner can share one address.
    const own = await createTestContext({ env: { RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES: "2" } });
    try {
      const owner = agentFor(own.app);
      await signUp(owner, new SoftwareAuthenticator(), "honest@allowed.test");
      const device = await createDevice(owner, { name: "Honest phone" });
      const guess = () => postOverland(own.app, `trl_${"C".repeat(43)}`, { locations: [] });
      await guess().expect(401);
      await guess().expect(401);
      for (let attempt = 0; attempt < 30; attempt += 1) await guess().expect(429);

      const upload = await postOverland(own.app, device.credentials.accessToken, {
        locations: [],
      }).expect(200);
      expect(upload.body).toEqual({ result: "ok" });
      await request(own.app)
        .get("/api/overland")
        .set("Authorization", `Bearer ${device.credentials.accessToken}`)
        .expect(200);
      // The valid uploads neither reset nor used the failure budget of the address.
      await guess().expect(429);
    } finally {
      await own.close();
    }
  });

  it("limits uploads per device token", async () => {
    // Its own app: the auth limit above is already used up by now.
    const own = await createTestContext({ env: { RATE_LIMIT_INGEST_PER_MINUTE: "2" } });
    try {
      const owner = agentFor(own.app);
      await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
      const device = await createDevice(owner, { name: "Chatty phone" });
      const upload = () => postOverland(own.app, device.credentials.accessToken, { locations: [] });
      await upload().expect(200);
      await upload().expect(200);
      const limited = await upload().expect(429);
      expect(typeof limited.body.error).toBe("string");
    } finally {
      await own.close();
    }
  });

  it("limits every other API request per IP", async () => {
    let status = 0;
    for (let attempt = 0; attempt < 12 && status !== 429; attempt += 1) {
      status = (await request(t.app).get("/api/devices")).status;
    }
    expect(status).toBe(429);
    // Health checks are never limited.
    await request(t.app).get("/api/health/live").expect(200);
  });
});
