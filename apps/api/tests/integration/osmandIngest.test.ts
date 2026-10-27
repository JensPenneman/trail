import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceResponseSchema } from "@trail/contracts/device";
import { ingestLogResponseSchema } from "@trail/contracts/ingestLog";
import { locationsPageSchema } from "@trail/contracts/location";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deviceEvents } from "../../src/db/schema/deviceEvents";
import { ingestRejects } from "../../src/db/schema/ingestRejects";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { basicAuth, createDevice, postOwnTracks } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import {
  gpsloggerQuery,
  osmandQuery,
  owntracksAndroidLocation,
  seconds,
  traccarForm,
  traccarJson,
} from "../support/trackerSamples";

/*
 * The OsmAnd format against the real app, as Traccar Client (10, 9 and the old
 * Android client), OsmAnd and GPSLogger send it (support/trackerSamples.ts):
 * `200` with an empty body for everything taken, the speed read in the unit
 * of the device's app.
 */
let t: TestContext;
let owner: Agent;
const lines: string[] = [];
const devices: Record<"traccar" | "osmand" | "gpslogger", { id: string; token: string }> = {
  traccar: { id: "", token: "" },
  osmand: { id: "", token: "" },
  gpslogger: { id: "", token: "" },
};

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ logDestination: { write: (line: string) => lines.push(line) } });
  owner = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  for (const source of ["traccar", "osmand", "gpslogger"] as const) {
    const created = await createDevice(owner, { name: `Phone with ${source}`, source });
    devices[source] = { id: created.device.id, token: created.credentials.accessToken };
  }
});

afterAll(async () => {
  await t.close();
});

const minutesAgo = (minutes: number) =>
  new Date(Math.floor(Date.now() / 1000) * 1000 - minutes * 60_000);

const latestLog = async (deviceId: string) => {
  const response = await owner.get(`${apiPaths.devices.ingestLog(deviceId)}?limit=1`).expect(200);
  return ingestLogResponseSchema.parse(response.body).entries[0];
};

const pointsOf = async (deviceId: string) => {
  const response = await owner.get(`/api/locations?deviceId=${deviceId}&limit=500`).expect(200);
  return locationsPageSchema.parse(response.body).items;
};

const deviceOf = async (deviceId: string) => {
  const response = await owner.get(apiPaths.devices.one(deviceId)).expect(200);
  return deviceResponseSchema.parse(response.body).device;
};

const postForm = (body: string) =>
  request(t.app)
    .post(apiPaths.osmand)
    .set("Content-Type", "application/x-www-form-urlencoded")
    .send(body);

describe("the OsmAnd format", () => {
  it("stores Traccar Client's form, its knots as m/s, and answers an empty 200", async () => {
    const at = minutesAgo(40);
    const { id, token } = devices.traccar;
    const response = await postForm(traccarForm(token, at)).expect(200);
    expect(response.text).toBe("");
    expect(await latestLog(id)).toMatchObject({
      source: "traccar",
      records: 1,
      locations: 1,
      duplicates: 0,
      rejected: 0,
    });
    const [point] = await pointsOf(id);
    expect(point).toMatchObject({
      recordedAt: at.toISOString(),
      lat: 51.0543,
      lon: 3.7174,
      altitude: 11.5,
      course: 92.5,
      accuracy: 4.8,
      batteryLevel: 0.81,
      batteryState: "unplugged",
      extra: null,
    });
    expect(point?.speed).toBeCloseTo(5.0004, 3);
    expect(await deviceOf(id)).toMatchObject({
      lastLocation: { recordedAt: at.toISOString(), accuracy: 4.8 },
      battery: { level: 0.81, state: "unplugged" },
      counts: { total: 1 },
    });
    const cells = await t.ctx.db.execute<{ z: number; total: number }>(
      sql`SELECT z, sum(count)::int AS total FROM heat_cells WHERE device_id = ${id} GROUP BY z ORDER BY z`,
    );
    expect(cells.rows).toEqual([6, 9, 12, 15, 18].map((z) => ({ z, total: 1 })));
  });

  it("stores a position sent again once", async () => {
    const { id, token } = devices.traccar;
    await postForm(traccarForm(token, minutesAgo(40))).expect(200);
    expect(await latestLog(id)).toMatchObject({ records: 1, locations: 0, duplicates: 1 });
    expect(await pointsOf(id)).toHaveLength(1);
  });

  it("takes the old Android client's query on a POST without a body", async () => {
    const at = minutesAgo(39);
    const { id, token } = devices.traccar;
    const query = new URLSearchParams({
      id: token,
      timestamp: String(seconds(at)),
      lat: "51.0544",
      lon: "3.7175",
      speed: "1.0",
      bearing: "0.0",
      altitude: "0.0",
      accuracy: "0.0",
      batt: "85.0",
      charge: "true",
    });
    await request(t.app).post(`${apiPaths.osmand}?${query}`).expect(200);
    const point = (await pointsOf(id)).find((item) => item.recordedAt === at.toISOString());
    expect(point).toMatchObject({ accuracy: null, batteryState: "charging" });
    expect(point?.speed).toBeCloseTo(0.514, 3);
  });

  it("takes Traccar Client 9's JSON, motion activity included, without its query-text copy", async () => {
    const at = minutesAgo(38);
    const { id, token } = devices.traccar;
    await request(t.app).post(apiPaths.osmand).send(traccarJson(token, at)).expect(200);
    const point = (await pointsOf(id)).find((item) => item.recordedAt === at.toISOString());
    expect(point).toMatchObject({
      speed: 13.9,
      course: null,
      motion: ["automotive"],
      batteryLevel: 0.42,
      batteryState: "charging",
    });
    expect(point?.extra).not.toHaveProperty("_");
  });

  it("stores OsmAnd's GET with its milliseconds and m/s", async () => {
    const at = new Date(minutesAgo(37).getTime() + 250);
    const { id, token } = devices.osmand;
    await request(t.app)
      .get(`${apiPaths.osmand}?${osmandQuery(token, at)}`)
      .expect(200, "");
    expect(await pointsOf(id)).toEqual([
      expect.objectContaining({
        recordedAt: at.toISOString(),
        speed: 1.5,
        accuracy: 6,
        batteryLevel: 0.64,
      }),
    ]);
    expect(await latestLog(id)).toMatchObject({ source: "osmand", locations: 1 });
  });

  it("stores GPSLogger's GET with the token in a header", async () => {
    const at = minutesAgo(36);
    const { id, token } = devices.gpslogger;
    await request(t.app)
      .get(`${apiPaths.osmand}?${gpsloggerQuery(at)}&hdop=0.8`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(await pointsOf(id)).toEqual([
      expect.objectContaining({
        recordedAt: at.toISOString(),
        speed: 12.5,
        accuracy: 8,
        batteryState: "charging",
        extra: { hdop: "0.8" },
      }),
    ]);
  });

  it("records a heartbeat without a position and an alarm as events", async () => {
    const at = minutesAgo(35);
    const { id, token } = devices.traccar;
    const before = await deviceOf(id);
    await postForm(
      new URLSearchParams({ id: token, timestamp: String(seconds(at)), batt: "40" }).toString(),
    ).expect(200);
    expect(await latestLog(id)).toMatchObject({ records: 1, locations: 0, events: 1 });
    const after = await deviceOf(id);
    expect(after.battery).toMatchObject({ level: 0.4 });
    expect(after.lastLocation).toEqual(before.lastLocation);
    await postForm(traccarForm(token, minutesAgo(34), { alarm: "sos" })).expect(200);
    const events = await t.ctx.db
      .select({ action: deviceEvents.action })
      .from(deviceEvents)
      .where(eq(deviceEvents.deviceId, id));
    expect(events.map((event) => event.action).sort()).toEqual(["alarm", "heartbeat"]);
  });

  it("keeps a record it cannot take in the dead letter — never the token — and acknowledges it", async () => {
    const { id, token } = devices.traccar;
    await postForm(traccarForm(token, minutesAgo(33), { timestamp: "2026-10-27 09:59:30" })).expect(
      200,
      "",
    );
    const many = Array.from({ length: 101 }, (_, n) => `p${n}=1`).join("&");
    await postForm(`${traccarForm(token, minutesAgo(32))}&${many}`).expect(200);
    const rejects = await t.ctx.db
      .select({ reason: ingestRejects.reason, record: ingestRejects.record })
      .from(ingestRejects)
      .where(eq(ingestRejects.deviceId, id));
    expect(rejects.map((reject) => reject.reason).sort()).toEqual([
      "invalid timestamp",
      "too many parameters",
    ]);
    expect(JSON.stringify(rejects)).not.toContain(token);
    expect(rejects[0]?.record).toMatchObject({ lat: "51.0543" });
  });

  it("refuses missing, unknown and malformed tokens", async () => {
    const missing = await request(t.app).get(`${apiPaths.osmand}?lat=1&lon=2`).expect(401);
    expect(missing.body).toEqual({ error: "Invalid access token" });
    expect(missing.headers["www-authenticate"]).toContain("Bearer");
    await postForm(traccarForm(`trl_${"Q".repeat(43)}`, minutesAgo(31))).expect(401);
    // Traccar Client's own random identifiers are no token: no lookup, 401.
    await postForm(traccarForm("12345678", minutesAgo(31))).expect(401);
  });

  it("takes Basic over HTTPS only", async () => {
    const { token } = devices.gpslogger;
    const url = `${apiPaths.osmand}?${gpsloggerQuery(minutesAgo(30))}`;
    await request(t.app).get(url).set("Authorization", basicAuth("phone", token)).expect(403);
    await request(t.app)
      .get(url)
      .set("Authorization", basicAuth("phone", token))
      .set("X-Forwarded-Proto", "https")
      .expect(200);
  });

  it("refuses other methods, HEAD included, and bodies over 64 kB", async () => {
    for (const method of ["put", "delete", "head"] as const) {
      const response = await request(t.app)[method](apiPaths.osmand).expect(405);
      expect(response.headers["allow"]).toBe("GET, POST");
    }
    const large = await postForm(
      `${traccarForm(devices.traccar.token, minutesAgo(29))}&padding=${"x".repeat(70_000)}`,
    ).expect(413);
    expect(large.body).toEqual({ error: "Payload too large" });
  });

  it("takes a token at its app's endpoint only", async () => {
    const owntracks = await createDevice(owner, { name: "Pixel", source: "owntracks" });
    const response = await postForm(
      traccarForm(owntracks.credentials.accessToken, minutesAgo(28)),
    ).expect(403);
    expect(response.body.error).toMatch(/set up for OwnTracks/);
    await postOwnTracks(
      t.app,
      devices.traccar.token,
      owntracksAndroidLocation(minutesAgo(28)),
    ).expect(403);
  });

  it("never logs the token, a parameter's value or a coordinate above debug", () => {
    const logged = lines.join("\n");
    for (const { token } of Object.values(devices)) expect(logged).not.toContain(token);
    expect(logged).not.toContain("51.0543");
    expect(logged).not.toContain("3.7174");
    expect(logged).toContain("/api/osmand?token=[redacted]&lat=[redacted]");
  });
});

describe("the OsmAnd format's rate limits", () => {
  it("answers 429 with Retry-After over the device's budget", async () => {
    const own = await createTestContext({ env: { RATE_LIMIT_INGEST_SINGLE_PER_MINUTE: "2" } });
    try {
      const agent = agentFor(own.app);
      await signUp(agent, new SoftwareAuthenticator(), "busy@allowed.test");
      const busy = await createDevice(agent, { name: "Busy phone", source: "traccar" });
      const send = (minute: number) =>
        request(own.app)
          .post(apiPaths.osmand)
          .type("form")
          .send(traccarForm(busy.credentials.accessToken, minutesAgo(minute)));
      await send(3).expect(200);
      await send(2).expect(200);
      const limited = await send(1).expect(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    } finally {
      await own.close();
    }
  });

  it("counts unknown tokens of every ingest endpoint in one budget per address", async () => {
    const own = await createTestContext({ env: { RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES: "2" } });
    try {
      const guess = `trl_${"G".repeat(43)}`;
      await request(own.app).get(`${apiPaths.osmand}?id=${guess}`).expect(401);
      await postOwnTracks(own.app, guess, owntracksAndroidLocation(minutesAgo(1))).expect(401);
      const limited = await request(own.app)
        .post(apiPaths.overland)
        .set("Authorization", `Bearer ${guess}`)
        .send({ locations: [] })
        .expect(429);
      expect(typeof limited.body.error).toBe("string");
    } finally {
      await own.close();
    }
  });
});
