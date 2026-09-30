import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceResponseSchema } from "@trail/contracts/device";
import { ingestLogResponseSchema } from "@trail/contracts/ingestLog";
import { locationsPageSchema } from "@trail/contracts/location";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devices } from "../../src/db/schema/devices";
import { ingestRejects } from "../../src/db/schema/ingestRejects";
import { checkSilentDevices } from "../../src/jobs/checkSilentDevices";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;
let owner: Agent;
let deviceId = "";
let token = "";

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  const created = await createDevice(owner, { name: "iPhone" });
  deviceId = created.device.id;
  token = created.credentials.accessToken;
});

afterAll(async () => {
  await t.close();
});

const latestLog = async () => {
  const response = await owner.get(`${apiPaths.devices.ingestLog(deviceId)}?limit=1`).expect(200);
  return ingestLogResponseSchema.parse(response.body).entries[0];
};

const point = (timestamp: string, coordinates: number[] = [3.7174, 51.0543]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties: { timestamp, horizontal_accuracy: 10 },
});

describe("Overland ingest", () => {
  it("stores a realistic batch and acknowledges it", async () => {
    const response = await postOverland(t.app, token, overlandFixture()).expect(200);
    expect(response.body).toEqual({ result: "ok" });
    expect(await latestLog()).toMatchObject({
      records: 34,
      locations: 30,
      duplicates: 0,
      visits: 1,
      trips: 1,
      events: 2,
      rejected: 0,
      userAgent: "Overland/2025.9 CFNetwork Darwin",
    });
  });

  it("updates the device cache from the newest data and the live trip", async () => {
    const response = await owner.get(apiPaths.devices.one(deviceId)).expect(200);
    const { device } = deviceResponseSchema.parse(response.body);
    expect(device.lastSeenAt).not.toBeNull();
    expect(device.lastLocation).toMatchObject({
      recordedAt: "2026-09-29T07:15:00.000Z",
      accuracy: 6,
      speed: 4.9,
      course: 251,
      motion: ["cycling"],
    });
    expect(device.battery).toEqual({
      level: 0.77,
      state: "unplugged",
      recordedAt: "2026-09-29T07:15:00.000Z",
    });
    expect(device.liveTrip).toEqual({
      mode: "bicycle",
      startedAt: "2026-09-29T06:30:12.000Z",
      distanceM: 14_120.6,
    });
    expect(device.counts.total).toBe(30);
  });

  it("maps sentinels to null and keeps the unmapped properties", async () => {
    const response = await owner.get(`/api/locations?deviceId=${deviceId}&limit=500`).expect(200);
    const page = locationsPageSchema.parse(response.body);
    expect(page.items).toHaveLength(30);
    const byTime = new Map(page.items.map((item) => [item.recordedAt, item]));
    const noSpeed = byTime.get("2026-09-29T06:46:45.000Z");
    expect(noSpeed).toMatchObject({
      speed: null,
      course: null,
      speedAccuracy: null,
      courseAccuracy: null,
    });
    const noAltitude = byTime.get("2026-09-29T06:55:45.000Z");
    expect(noAltitude).toMatchObject({ altitude: null, verticalAccuracy: null });
    expect(page.items[0]?.extra).toMatchObject({
      device_id: "iphone-jens",
      unique_id: "5E0B7C1A-8A7D-4C49-9E62-3B2F1D6A0C44",
      pauses: false,
      activity: "fitness",
      desired_accuracy: 100,
      deferred: 0,
      significant_change: "disabled",
      locations_in_payload: 30,
    });
    expect(page.items[0]).toMatchObject({
      motion: ["cycling"],
      batteryState: "unplugged",
      wifi: null,
    });
  });

  it("skips a re-sent batch (Overland retries until it gets an ack)", async () => {
    await postOverland(t.app, token, overlandFixture()).expect(200);
    expect(await latestLog()).toMatchObject({
      records: 34,
      locations: 0,
      duplicates: 30,
      visits: 0,
      trips: 0,
      events: 0,
    });
    const [row] = await t.ctx.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(row?.pointsTotal).toBe(30);
  });

  it("aggregates heat cells for every level in the same statement", async () => {
    const result = await t.ctx.db.execute<{ z: number; total: number }>(
      sql`SELECT z, sum(count)::int AS total FROM heat_cells WHERE device_id = ${deviceId} GROUP BY z ORDER BY z`,
    );
    expect(result.rows).toEqual([6, 9, 12, 15, 18].map((z) => ({ z, total: 30 })));
  });

  it("acknowledges batches with invalid records and keeps them in the dead letter", async () => {
    const response = await postOverland(t.app, token, {
      locations: [
        point("2026-09-30T08:00:00Z"),
        point("2026-09-30T08:00:01Z", [0, 0]),
        point("2026-09-30T08:00:02Z", [200, 51]),
        point("half past eight"),
        point("2099-01-01T00:00:00Z"),
        "not a feature",
      ],
    }).expect(200);
    expect(response.body).toEqual({ result: "ok" });
    expect(await latestLog()).toMatchObject({ records: 6, locations: 1, rejected: 5 });
    const rejects = await t.ctx.db
      .select({ reason: ingestRejects.reason, record: ingestRejects.record })
      .from(ingestRejects)
      .where(eq(ingestRejects.deviceId, deviceId));
    expect(rejects.map((reject) => reject.reason).sort()).toEqual([
      "coordinates are exactly 0,0",
      "coordinates out of range",
      "invalid timestamp",
      "record is not an object",
      "timestamp is more than 24 h in the future",
    ]);
    expect(rejects.some((reject) => reject.record === "not a feature")).toBe(true);
  });

  it("accepts legacy offsets without a colon", async () => {
    await postOverland(t.app, token, { locations: [point("2015-10-01T08:00:00-0700")] }).expect(
      200,
    );
    const response = await owner
      .get(`/api/locations?deviceId=${deviceId}&before=2016-01-01T00:00:00.000Z&limit=1`)
      .expect(200);
    expect(locationsPageSchema.parse(response.body).items[0]?.recordedAt).toBe(
      "2015-10-01T15:00:00.000Z",
    );
  });

  it("answers 401 with Overland's error body for missing or unknown tokens", async () => {
    const missing = await request(t.app).post("/api/overland").send({ locations: [] }).expect(401);
    expect(missing.body).toEqual({ error: "Invalid access token" });
    expect(missing.headers["www-authenticate"]).toContain("Bearer");
    const unknown = await postOverland(t.app, `trl_${"A".repeat(43)}`, { locations: [] }).expect(
      401,
    );
    expect(unknown.body).toEqual({ error: "Invalid access token" });
    await postOverland(t.app, "not-a-token", { locations: [] }).expect(401);
  });

  it("accepts the token as ?token= or ?access_token=", async () => {
    await request(t.app).post(`/api/overland?token=${token}`).send({ locations: [] }).expect(200);
    await request(t.app)
      .post(`/api/overland?access_token=${token}`)
      .send({ locations: [] })
      .expect(200);
    const probe = await request(t.app).get(`/api/overland?token=${token}`).expect(200);
    expect(probe.body).toEqual({ name: "iPhone" });
  });

  it("explains what is wrong with a body that is not Overland's JSON", async () => {
    const message =
      'Expected Overland JSON with a "locations" array. In Overland set Logging Mode to “All Data”.';
    for (const body of [
      {},
      { _type: "location", lat: 51.05, lon: 3.72, tst: 1 },
      { locations: 5 },
      [],
    ]) {
      const response = await postOverland(t.app, token, body).expect(400);
      expect(response.body).toEqual({ error: message });
    }
    const malformed = await request(t.app)
      .post("/api/overland")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send("{oops")
      .expect(400);
    expect(typeof malformed.body.error).toBe("string");
  });

  it("refuses bodies over 5 MB", async () => {
    const response = await postOverland(t.app, token, {
      locations: [],
      padding: "x".repeat(5.5 * 1024 * 1024),
    }).expect(413);
    expect(response.body).toEqual({ error: "Payload too large" });
  });

  it("sends a queued settings preset exactly once", async () => {
    await owner
      .patch(apiPaths.devices.one(deviceId))
      .set("Origin", testOrigin)
      .send({ pendingSettings: "balanced" })
      .expect(200);
    const first = await postOverland(t.app, token, { locations: [] }).expect(200);
    expect(first.body).toEqual({
      result: "ok",
      set: {
        send_interval: "5m",
        main: expect.objectContaining({ tracking_mode: "standard", batch_size: 200 }),
      },
    });
    const second = await postOverland(t.app, token, { locations: [] }).expect(200);
    expect(second.body).toEqual({ result: "ok" });
    const response = await owner.get(apiPaths.devices.one(deviceId)).expect(200);
    const { device } = deviceResponseSchema.parse(response.body);
    expect(device.pendingSettings).toBeNull();
    expect(device.settingsAppliedAt).not.toBeNull();
  });

  it("alerts once for a silent device and again when it recovers", async () => {
    await t.ctx.db
      .update(devices)
      .set({ lastSeenAt: new Date(Date.now() - 13 * 3_600_000) })
      .where(eq(devices.id, deviceId));
    const job = {
      db: t.ctx.db,
      logger: t.ctx.logger,
      alerts: async (alert: (typeof t.alerts)[number]) => {
        t.alerts.push(alert);
      },
      staleAfterHours: 12,
    };
    expect(await checkSilentDevices(job)).toBe(1);
    expect(await checkSilentDevices(job)).toBe(0);
    expect(t.alerts[0]).toMatchObject({ title: "iPhone is silent", priority: "high" });
    expect(t.alerts[0]?.message).toContain("has sent nothing for 12 h");

    await postOverland(t.app, token, { locations: [] }).expect(200);
    await t.ctx.background.drain(2_000);
    expect(t.alerts[1]).toMatchObject({ title: "iPhone is back" });
    const [row] = await t.ctx.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(row?.staleAlertedAt).toBeNull();
  });

  it("answers 503 while the database is unreachable, so the phone keeps its data", async () => {
    const offline = await createTestContext({
      env: { DATABASE_URL: "postgres://trail:trail@127.0.0.1:1/trail_test" },
    });
    try {
      const response = await postOverland(offline.app, token, overlandFixture()).expect(503);
      expect(response.body).toEqual({ error: "Server temporarily unavailable" });
    } finally {
      await offline.close();
    }
  });

  it("does not take other methods", async () => {
    const response = await request(t.app).put("/api/overland").send({}).expect(405);
    expect(response.headers["allow"]).toBe("GET, POST");
  });
});
