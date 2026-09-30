import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceResponseSchema } from "@trail/contracts/device";
import { ingestLogResponseSchema } from "@trail/contracts/ingestLog";
import { locationsPageSchema } from "@trail/contracts/location";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRejects } from "../../src/db/schema/ingestRejects";
import { trips } from "../../src/db/schema/trips";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * A value that JavaScript accepts but Postgres refuses used to fail the whole
 * upload with a 500, and Overland resends an unacknowledged batch forever: the
 * phone's queue was wedged. Every such batch must be acknowledged, its good
 * records stored and the rest kept in the dead letter.
 */
let t: TestContext;
let owner: Agent;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
});

afterAll(async () => {
  await t.close();
});

const point = (timestamp: string, properties: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [3.7174, 51.0543] },
  properties: { timestamp, horizontal_accuracy: 10, ...properties },
});

async function newDevice(name: string) {
  const created = await createDevice(owner, { name });
  return { id: created.device.id, token: created.credentials.accessToken };
}

async function latestLog(deviceId: string) {
  const response = await owner.get(`${apiPaths.devices.ingestLog(deviceId)}?limit=1`).expect(200);
  return ingestLogResponseSchema.parse(response.body).entries[0];
}

async function storedPoints(deviceId: string) {
  const response = await owner.get(`/api/locations?deviceId=${deviceId}&limit=500`).expect(200);
  return new Map(
    locationsPageSchema.parse(response.body).items.map((item) => [item.recordedAt, item]),
  );
}

async function rejectsOf(deviceId: string) {
  return t.ctx.db
    .select({ reason: ingestRejects.reason, record: ingestRejects.record })
    .from(ingestRejects)
    .where(eq(ingestRejects.deviceId, deviceId));
}

describe("uploads with values Postgres cannot store", () => {
  it("are acknowledged, with every value made storable or the record rejected", async () => {
    const device = await newDevice("Poisoned phone");
    const batch = {
      locations: [
        point("2026-09-30T08:00:00Z"),
        point("2026-09-30T08:00:01Z", {
          wifi: "Home\u0000Net\ud800",
          motion: ["walk\u0000ing", "\udfff"],
          battery_state: "unplugged\u0000",
          "\u0000key": { "nested\u0000": ["\ud83d"] },
        }),
        point("2026-09-30T08:00:02Z", {
          speed: 3.5e38,
          course: 1e-40,
          altitude: -1e39,
          speed_accuracy: Number.MIN_VALUE,
          battery_level: 1e-45,
        }),
        point("0000-06-01T00:00:00Z"),
        point("\u0000"),
        {
          type: "Feature",
          properties: {
            type: "trip",
            mode: "car\u0000",
            start: "2026-09-30T07:00:00Z",
            end: "2026-09-30T07:30:00Z",
            steps: 2 ** 40,
            distance: 1e300,
            start_location: { properties: { name: "\ud800" } },
          },
        },
        {
          type: "Feature",
          properties: { action: "resumed\ud800", timestamp: "2026-09-30T08:00:03Z" },
        },
      ],
      current: point("2026-09-30T08:00:05Z", { speed: 1e39, wifi: "\u0000" }),
      trip: { mode: "car\u0000", start: "0000-01-01T00:00:00Z" },
    };

    const response = await postOverland(t.app, device.token, batch).expect(200);
    expect(response.body).toEqual({ result: "ok" });
    expect(await latestLog(device.id)).toMatchObject({
      records: 7,
      locations: 3,
      duplicates: 0,
      trips: 1,
      events: 1,
      rejected: 2,
    });

    const points = await storedPoints(device.id);
    expect(points.get("2026-09-30T08:00:01.000Z")).toMatchObject({
      wifi: "HomeNet�",
      motion: ["walking", "�"],
      batteryState: null,
      extra: { key: { nested: ["�"] } },
    });
    expect(points.get("2026-09-30T08:00:02.000Z")).toMatchObject({
      speed: null,
      course: null,
      altitude: null,
      speedAccuracy: null,
      batteryLevel: null,
    });
    const [trip] = await t.ctx.db.select().from(trips).where(eq(trips.deviceId, device.id));
    expect(trip).toMatchObject({ mode: "car", steps: null, distanceM: 1e300 });
    expect(trip?.startLocation).toEqual({ properties: { name: "�" } });

    const rejects = await rejectsOf(device.id);
    expect(rejects.map((reject) => reject.reason).sort()).toEqual([
      "invalid timestamp",
      "timestamp is before 1990",
    ]);
    expect(rejects.some((reject) => JSON.stringify(reject.record).includes('"timestamp":""'))).toBe(
      true,
    );

    const { device: summary } = deviceResponseSchema.parse(
      (await owner.get(apiPaths.devices.one(device.id)).expect(200)).body,
    );
    expect(summary.lastLocation).toMatchObject({
      recordedAt: "2026-09-30T08:00:05.000Z",
      speed: null,
    });
    expect(summary.liveTrip).toBeNull();

    // Overland resends a batch until it sees the ack: the resend must be fine as well.
    await postOverland(t.app, device.token, batch).expect(200);
    expect(await latestLog(device.id)).toMatchObject({ locations: 0, duplicates: 3, rejected: 2 });
  });

  it("store what the database accepts when it still refuses a record, and file that one", async () => {
    const device = await newDevice("Refused phone");
    // A value the normalisation cannot know about: a constraint of this test.
    await t.ctx.db.execute(
      sql`ALTER TABLE locations ADD CONSTRAINT test_refused_altitude CHECK (altitude IS DISTINCT FROM 4321)`,
    );
    try {
      const batch = {
        locations: [
          point("2026-09-30T09:00:00Z"),
          point("2026-09-30T09:00:01Z", { altitude: 4321, wifi: "\u0000Cafe" }),
          point("2026-09-30T09:00:02Z"),
        ],
      };
      const response = await postOverland(t.app, device.token, batch).expect(200);
      expect(response.body).toEqual({ result: "ok" });
      expect(await latestLog(device.id)).toMatchObject({ records: 3, locations: 2, rejected: 1 });
      expect([...(await storedPoints(device.id)).keys()].sort()).toEqual([
        "2026-09-30T09:00:00.000Z",
        "2026-09-30T09:00:02.000Z",
      ]);
      const [reject] = await rejectsOf(device.id);
      expect(reject).toMatchObject({
        reason: "refused by the database (SQLSTATE 23514)",
        record: { properties: { altitude: 4321, wifi: "Cafe" } },
      });

      await postOverland(t.app, device.token, batch).expect(200);
      expect(await latestLog(device.id)).toMatchObject({
        locations: 0,
        duplicates: 2,
        rejected: 1,
      });
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE locations DROP CONSTRAINT test_refused_altitude`);
    }
  });

  it("are acknowledged when a record nests deeper than anything can be stored", async () => {
    const device = await newDevice("Nested phone");
    const deep = `${"[".repeat(50_000)}1${"]".repeat(50_000)}`;
    const body = `{"locations":[{"type":"Feature","geometry":{"type":"Point","coordinates":[3.7,51]},"properties":{"timestamp":"2026-09-30T11:00:00Z","deep":${deep}}},{"type":"Feature","properties":{"timestamp":"nope","deep":${deep}}}]}`;
    const response = await request(t.app)
      .post("/api/overland")
      .set("Authorization", `Bearer ${device.token}`)
      .set("Content-Type", "application/json")
      .send(body)
      .expect(200);
    expect(response.body).toEqual({ result: "ok" });
    expect(await latestLog(device.id)).toMatchObject({ locations: 1, rejected: 1 });
  });

  it("still record the upload when the device's newest readings are what the database refuses", async () => {
    const device = await newDevice("Refused cache");
    await t.ctx.db.execute(
      sql`ALTER TABLE devices ADD CONSTRAINT test_refused_cache CHECK (last_altitude IS DISTINCT FROM 4321)`,
    );
    try {
      const response = await postOverland(t.app, device.token, {
        locations: [point("2026-09-30T10:00:00Z", { altitude: 4321 })],
      }).expect(200);
      expect(response.body).toEqual({ result: "ok" });
      expect(await latestLog(device.id)).toMatchObject({ locations: 1, rejected: 0 });
      const { device: summary } = deviceResponseSchema.parse(
        (await owner.get(apiPaths.devices.one(device.id)).expect(200)).body,
      );
      expect(summary.lastSeenAt).not.toBeNull();
      expect(summary.lastLocation).toBeNull();
      expect(summary.counts.total).toBe(1);
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE devices DROP CONSTRAINT test_refused_cache`);
    }
  });
});
