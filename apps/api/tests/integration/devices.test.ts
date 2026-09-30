import { apiPaths } from "@trail/contracts/apiPaths";
import {
  deviceListResponseSchema,
  deviceResponseSchema,
  deviceWithCredentialsResponseSchema,
} from "@trail/contracts/device";
import { apiErrorSchema } from "@trail/contracts/errors";
import { overlandSetupUrl } from "@trail/contracts/overlandSetupUrl";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;
let owner: Agent;
let stranger: Agent;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  stranger = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");
});

afterAll(async () => {
  await t.close();
});

const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;

describe("devices", () => {
  let deviceId = "";
  let token = "";

  it("creates a device and shows its Overland credentials once", async () => {
    const created = await createDevice(owner, { name: "Jens’s iPhone" });
    const { device, credentials } = created;
    expect(credentials.accessToken).toMatch(/^trl_[A-Za-z0-9_-]{43}$/);
    expect(credentials.deviceKey).toMatch(/^jenss-iphone-[a-z0-9]{4}$/);
    expect(credentials.endpoint).toBe(`${testOrigin}/api/overland`);
    expect(credentials.setupUrl).toBe(
      overlandSetupUrl({
        endpoint: credentials.endpoint,
        accessToken: credentials.accessToken,
        deviceKey: credentials.deviceKey,
      }),
    );
    expect(device).toMatchObject({
      name: "Jens’s iPhone",
      source: "overland",
      tokenHint: credentials.accessToken.slice(-4),
      alertsEnabled: true,
      lastSeenAt: null,
      lastLocation: null,
      battery: null,
      liveTrip: null,
      counts: { today: 0, last24h: 0, total: 0 },
      pendingSettings: null,
    });
    deviceId = device.id;
    token = credentials.accessToken;

    const listed = await owner.get(apiPaths.devices.root).expect(200);
    expect(deviceListResponseSchema.parse(listed.body).devices.map((item) => item.id)).toEqual([
      deviceId,
    ]);
    const got = await owner.get(apiPaths.devices.one(deviceId)).expect(200);
    expect(JSON.stringify(got.body)).not.toContain(token);
  });

  it("accepts a chosen Device ID once per user", async () => {
    await createDevice(owner, { name: "Watch", deviceKey: "watch" });
    const duplicate = await owner
      .post(apiPaths.devices.root)
      .set("Origin", testOrigin)
      .send({ name: "Other watch", deviceKey: "watch" })
      .expect(409);
    expect(apiErrorSchema.parse(duplicate.body).error.fields).toHaveProperty("deviceKey");
    // Another user may use the same Device ID.
    await createDevice(stranger, { name: "Watch", deviceKey: "watch" });
  });

  it("validates new devices", async () => {
    const invalid = await owner
      .post(apiPaths.devices.root)
      .set("Origin", testOrigin)
      .send({ name: " ", deviceKey: "Not A Slug" })
      .expect(400);
    const fields = apiErrorSchema.parse(invalid.body).error.fields ?? {};
    expect(Object.keys(fields).sort()).toEqual(["deviceKey", "name"]);
  });

  it("updates name, alerts and the queued settings preset", async () => {
    const response = await owner
      .patch(apiPaths.devices.one(deviceId))
      .set("Origin", testOrigin)
      .send({ name: "iPhone 15", alertsEnabled: false, pendingSettings: "battery-saver" })
      .expect(200);
    expect(deviceResponseSchema.parse(response.body).device).toMatchObject({
      name: "iPhone 15",
      alertsEnabled: false,
      pendingSettings: "battery-saver",
    });
    const cancelled = await owner
      .patch(apiPaths.devices.one(deviceId))
      .set("Origin", testOrigin)
      .send({ pendingSettings: null })
      .expect(200);
    expect(deviceResponseSchema.parse(cancelled.body).device.pendingSettings).toBeNull();
    await owner
      .patch(apiPaths.devices.one(deviceId))
      .set("Origin", testOrigin)
      .send({})
      .expect(400);
    await owner
      .patch(apiPaths.devices.one(deviceId))
      .set("Origin", testOrigin)
      .send({ pendingSettings: "turbo" })
      .expect(400);
  });

  it("rotates the token: the old one stops working at once", async () => {
    await request(t.app).get("/api/overland").set("Authorization", `Bearer ${token}`).expect(200);
    const rotated = await owner
      .post(apiPaths.devices.token(deviceId))
      .set("Origin", testOrigin)
      .expect(200);
    const { credentials, device } = deviceWithCredentialsResponseSchema.parse(rotated.body);
    expect(credentials.accessToken).not.toBe(token);
    expect(device.tokenHint).toBe(credentials.accessToken.slice(-4));
    const old = await request(t.app)
      .get("/api/overland")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(old.body).toEqual({ error: "Invalid access token" });
    const probe = await request(t.app)
      .get("/api/overland")
      .set("Authorization", `Bearer ${credentials.accessToken}`)
      .expect(200);
    expect(probe.body).toEqual({ name: "iPhone 15" });
    token = credentials.accessToken;
  });

  it("answers 404 for other people's and unknown devices", async () => {
    for (const path of [
      apiPaths.devices.one(deviceId),
      apiPaths.devices.ingestLog(deviceId),
      apiPaths.devices.one("0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"),
      apiPaths.devices.one("not-a-uuid"),
    ]) {
      const response = await stranger.get(path).expect(404);
      expect(errorCode(response.body)).toBe("not_found");
    }
    await stranger
      .patch(apiPaths.devices.one(deviceId))
      .set("Origin", testOrigin)
      .send({ name: "mine" })
      .expect(404);
    await stranger.post(apiPaths.devices.token(deviceId)).set("Origin", testOrigin).expect(404);
    await stranger.delete(apiPaths.devices.one(deviceId)).set("Origin", testOrigin).expect(404);
    await request(t.app).get(apiPaths.devices.root).expect(401);
  });

  it("deletes a device with its token", async () => {
    await owner.delete(apiPaths.devices.one(deviceId)).set("Origin", testOrigin).expect(204);
    await owner.get(apiPaths.devices.one(deviceId)).expect(404);
    await request(t.app).get("/api/overland").set("Authorization", `Bearer ${token}`).expect(401);
  });
});
