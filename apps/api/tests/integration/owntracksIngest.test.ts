import { gzipSync } from "node:zlib";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceResponseSchema } from "@trail/contracts/device";
import { apiErrorSchema } from "@trail/contracts/errors";
import { ingestLogResponseSchema } from "@trail/contracts/ingestLog";
import { locationsPageSchema } from "@trail/contracts/location";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deviceEvents } from "../../src/db/schema/deviceEvents";
import { ingestRejects } from "../../src/db/schema/ingestRejects";
import { heatCellZooms } from "../../src/heatmap/heatCellLevels";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { basicAuth, createDevice, postOverland, postOwnTracks } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";
import {
  owntracksAndroidLocation,
  owntracksIosLocation,
  owntracksTransition,
  seconds,
} from "../support/trackerSamples";

/*
 * OwnTracks in HTTP mode against the real app: one JSON message per request,
 * the token as Basic password or bearer token, `200 []` for everything taken.
 * The messages are built from the apps' sources (support/trackerSamples.ts).
 */
let t: TestContext;
let owner: Agent;
let deviceId = "";
let token = "";
const lines: string[] = [];

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ logDestination: { write: (line: string) => lines.push(line) } });
  owner = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  const created = await createDevice(owner, { name: "Pixel 8", source: "owntracks" });
  deviceId = created.device.id;
  token = created.credentials.accessToken;
});

afterAll(async () => {
  await t.close();
});

const minutesAgo = (minutes: number) =>
  new Date(Math.floor(Date.now() / 1000) * 1000 - minutes * 60_000);

const latestLog = async () => {
  const response = await owner.get(`${apiPaths.devices.ingestLog(deviceId)}?limit=1`).expect(200);
  return ingestLogResponseSchema.parse(response.body).entries[0];
};

const pointsOf = async (id: string) => {
  const response = await owner.get(`/api/locations?deviceId=${id}&limit=500`).expect(200);
  return locationsPageSchema.parse(response.body).items;
};

const rejectsOf = (id: string) =>
  t.ctx.db
    .select({ reason: ingestRejects.reason, record: ingestRejects.record })
    .from(ingestRejects)
    .where(eq(ingestRejects.deviceId, id));

describe("OwnTracks ingest", () => {
  const at = minutesAgo(30);

  it("stores Android's location and answers the empty list of messages", async () => {
    const response = await postOwnTracks(t.app, token, owntracksAndroidLocation(at)).expect(200);
    expect(response.body).toEqual([]);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(await latestLog()).toMatchObject({
      source: "owntracks",
      records: 1,
      locations: 1,
      duplicates: 0,
      events: 0,
      rejected: 0,
      userAgent: "Owntracks-Android/gms/420509000",
    });
    const [point] = await pointsOf(deviceId);
    expect(point).toMatchObject({
      recordedAt: at.toISOString(),
      lat: 51.0543,
      lon: 3.7174,
      altitude: 45,
      speed: 5,
      course: 271,
      accuracy: 12,
      verticalAccuracy: 3,
      batteryLevel: 0.76,
      batteryState: "unplugged",
      wifi: "Home Wi-Fi",
    });
    expect(point?.extra).toMatchObject({
      t: "u",
      tid: "P8",
      conn: "w",
      BSSID: "aa:bb:cc:dd:ee:ff",
    });
  });

  it("updates the device's position and battery, and counts heat cells", async () => {
    const response = await owner.get(apiPaths.devices.one(deviceId)).expect(200);
    const { device } = deviceResponseSchema.parse(response.body);
    expect(device).toMatchObject({
      source: "owntracks",
      lastLocation: { recordedAt: at.toISOString(), speed: 5, accuracy: 12 },
      battery: { level: 0.76, state: "unplugged", recordedAt: at.toISOString() },
      liveTrip: null,
      counts: { total: 1 },
    });
    expect(device.lastSeenAt).not.toBeNull();
    const cells = await t.ctx.db.execute<{ z: number; total: number }>(
      sql`SELECT z, sum(count)::int AS total FROM heat_cells WHERE device_id = ${deviceId} GROUP BY z ORDER BY z`,
    );
    expect(cells.rows).toEqual(heatCellZooms.map((z) => ({ z, total: 1 })));
  });

  it("stores a message sent again once", async () => {
    await postOwnTracks(t.app, token, owntracksAndroidLocation(at)).expect(200);
    expect(await latestLog()).toMatchObject({ records: 1, locations: 0, duplicates: 1 });
    expect(await pointsOf(deviceId)).toHaveLength(1);
  });

  it("takes iOS's message with a bearer token, motion activity included", async () => {
    const later = minutesAgo(29);
    await request(t.app)
      .post(apiPaths.owntracks)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(owntracksIosLocation(later)))
      .expect(200, []);
    const point = (await pointsOf(deviceId)).find(
      (item) => item.recordedAt === later.toISOString(),
    );
    expect(point).toMatchObject({ motion: ["walking"], wifi: "Office", batteryState: "charging" });
    expect(point?.speed).toBeCloseTo(5 / 3.6, 5);
  });

  it("records transitions and the last will as events, and acknowledges what it leaves alone", async () => {
    const enter = minutesAgo(28);
    await postOwnTracks(t.app, token, owntracksTransition(enter, "enter", "Home")).expect(200, []);
    await postOwnTracks(t.app, token, { _type: "lwt", tst: seconds(enter) }).expect(200, []);
    for (const type of ["waypoint", "waypoints", "status", "cmd", "card", "beacon", "steps"]) {
      await postOwnTracks(t.app, token, { _type: type, tst: seconds(enter) }).expect(200, []);
      expect(await latestLog(), type).toMatchObject({
        records: 1,
        locations: 0,
        events: 0,
        rejected: 0,
      });
    }
    // A friend removed in the app: an empty body.
    await request(t.app)
      .post(apiPaths.owntracks)
      .set("Authorization", basicAuth("x", token))
      .set("X-Forwarded-Proto", "https")
      .set("Content-Type", "application/json")
      .send("")
      .expect(200, []);
    expect(await latestLog()).toMatchObject({ records: 0 });
    const events = await t.ctx.db
      .select({ action: deviceEvents.action, lat: deviceEvents.lat })
      .from(deviceEvents)
      .where(eq(deviceEvents.deviceId, deviceId));
    expect(events.map((event) => event.action).sort()).toEqual(["lwt", "region_enter:rid-home"]);
  });

  it("keeps an unreadable message in the dead letter and still acknowledges it", async () => {
    await postOwnTracks(
      t.app,
      token,
      owntracksAndroidLocation(minutesAgo(27), { lat: 0, lon: 0 }),
    ).expect(200, []);
    expect(await latestLog()).toMatchObject({ records: 1, locations: 0, rejected: 1 });
    await postOwnTracks(t.app, token, { _type: "encrypted", data: "Zm9v" }).expect(200, []);
    await request(t.app)
      .post(apiPaths.owntracks)
      .set("Authorization", basicAuth("x", token))
      .set("X-Forwarded-Proto", "https")
      .set("Content-Type", "application/json")
      .send("{oops")
      .expect(200, []);
    const reasons = (await rejectsOf(deviceId)).map((reject) => reject.reason).sort();
    expect(reasons).toEqual([
      "body is not JSON",
      "coordinates are exactly 0,0",
      "encrypted message: turn off encryption in OwnTracks",
    ]);
  });

  it("never stores a configuration dump, which holds the token", async () => {
    await postOwnTracks(t.app, token, {
      _type: "dump",
      configuration: { _type: "configuration", mode: 3, password: token },
    }).expect(200, []);
    const stored = await t.ctx.db.execute<{ found: number }>(sql`
      SELECT (
        (SELECT count(*) FROM ingest_rejects WHERE record::text LIKE ${`%${token}%`})
        + (SELECT count(*) FROM locations WHERE extra::text LIKE ${`%${token}%`})
        + (SELECT count(*) FROM device_events WHERE extra::text LIKE ${`%${token}%`})
        + (SELECT count(*) FROM ingest_log WHERE user_agent LIKE ${`%${token}%`})
      )::int AS found
    `);
    expect(stored.rows[0]?.found).toBe(0);
  });

  it("refuses missing and unknown tokens with a challenge for both schemes", async () => {
    const missing = await request(t.app).post(apiPaths.owntracks).send("{}").expect(401);
    expect(missing.body).toEqual({ error: "Invalid access token" });
    expect(missing.headers["www-authenticate"]).toContain('Basic realm="trail"');
    expect(missing.headers["www-authenticate"]).toContain('Bearer realm="trail"');
    await postOwnTracks(t.app, `trl_${"Z".repeat(43)}`, owntracksAndroidLocation(at)).expect(401);
    await postOwnTracks(t.app, "hunter2", owntracksAndroidLocation(at)).expect(401);
  });

  it("takes Basic over plain HTTP when the phones were given an http:// address", async () => {
    // The suite's PUBLIC_URL is http://: the address the phones got is the rule (§6).
    await request(t.app)
      .post(apiPaths.owntracks)
      .set("Authorization", basicAuth("pixel", token))
      .send(JSON.stringify(owntracksAndroidLocation(minutesAgo(26))))
      .expect(200, []);
  });

  it("takes a token at its app's endpoint only, and names the app elsewhere", async () => {
    const overland = await createDevice(owner, { name: "iPhone" });
    const atOwnTracks = await postOwnTracks(
      t.app,
      overland.credentials.accessToken,
      owntracksAndroidLocation(at),
    ).expect(403);
    expect(atOwnTracks.body.error).toMatch(/set up for Overland/);
    const atOverland = await postOverland(t.app, token, { locations: [] }).expect(403);
    expect(atOverland.body.error).toMatch(/set up for OwnTracks/);
    await request(t.app).get(apiPaths.overland).set("Authorization", `Bearer ${token}`).expect(403);
  });

  it("refuses other methods, bodies over 256 kB and compressed bodies", async () => {
    const get = await request(t.app).get(apiPaths.owntracks).expect(405);
    expect(get.headers["allow"]).toBe("POST");
    // A point of interest's photo, which the apps scale to 192 px, fits with room to spare.
    await postOwnTracks(t.app, token, {
      ...owntracksAndroidLocation(minutesAgo(25)),
      image: "x".repeat(150 * 1024),
    }).expect(200);
    const large = await postOwnTracks(t.app, token, {
      ...owntracksAndroidLocation(at),
      image: "x".repeat(260 * 1024),
    }).expect(413);
    expect(large.body).toEqual({ error: "Payload too large" });
    const compressed = await request(t.app)
      .post(apiPaths.owntracks)
      .set("Authorization", basicAuth("pixel", token))
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send(gzipSync(JSON.stringify(owntracksAndroidLocation(at))))
      .expect(415);
    expect(compressed.body).toEqual({ error: "Unsupported request body encoding." });
  });

  it("refuses settings presets for an OwnTracks device", async () => {
    const response = await owner
      .patch(apiPaths.devices.one(deviceId))
      .set("Origin", testOrigin)
      .send({ pendingSettings: "balanced" })
      .expect(409);
    expect(apiErrorSchema.parse(response.body).error.message).toMatch(/Overland only/);
  });

  it("never logs the token or a coordinate above debug", () => {
    const logged = lines.join("\n");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("51.0543");
    expect(logged).not.toContain(Buffer.from(`pixel-8-k3f9:${token}`).toString("base64"));
  });
});

describe("OwnTracks' rate limit", () => {
  it("answers 503 with Retry-After over the device's budget: OwnTracks for iOS drops a message on a 4xx", async () => {
    const own = await createTestContext({ env: { RATE_LIMIT_INGEST_SINGLE_PER_MINUTE: "2" } });
    try {
      const agent = agentFor(own.app);
      await signUp(agent, new SoftwareAuthenticator(), "busy@allowed.test");
      const busy = await createDevice(agent, { name: "Busy phone", source: "owntracks" });
      const send = (minute: number) =>
        postOwnTracks(
          own.app,
          busy.credentials.accessToken,
          owntracksAndroidLocation(minutesAgo(minute)),
        );
      await send(3).expect(200);
      await send(2).expect(200);
      const limited = await send(1).expect(503);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      expect(limited.headers["ratelimit-policy"]).toContain("ingest-owntracks");
    } finally {
      await own.close();
    }
  });
});
