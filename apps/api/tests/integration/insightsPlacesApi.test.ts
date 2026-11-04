import { apiPaths } from "@trail/contracts/apiPaths";
import { apiErrorSchema } from "@trail/contracts/errors";
import { insightsPlaceSchema, insightsPlacesSchema } from "@trail/contracts/insights";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { placeCellOf } from "../../src/insights/groupPlaces";
import { type Agent, agentFor, signUp, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FakeApiTokens, tokenPrincipal } from "../support/fakeApiTokens";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * Insights › Places (docs/architecture.md §8.7, §8.8) on stops written by
 * hand: two devices of the owner at home (joined, not added), a station named
 * from map data, a place named by the road the phone was on, a stay folded
 * into its neighbour; the three-year limit, the ETag and what moves it, the
 * scopes, devices, and what the access log keeps of a request.
 */
let t: TestContext;
const tokens = new FakeApiTokens();
let owner: Agent;
let phone = "";
let tracker = "";
let foreign = "";
let ownerId = "";

const ownerEmail = "first@example.com";
/** Home, a station 20 m from a stop, a place on Kerkstraat, in October 2026 (CEST until the 25th). */
const home = { lat: 51.0362, lon: 3.7104 };
const station = { lat: 51.09, lon: 3.73 };
const street = { lat: 51.15, lon: 3.8 };
const week = { from: "2026-10-19", to: "2026-10-25" };
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;

/** The centre of the cell `dx` east of the one a position lies in, at zoom 18. */
function eastOf(position: { lat: number; lon: number }, dx: number) {
  const [x = 0, y = 0] = placeCellOf(position.lat, position.lon).split(".").map(Number);
  const tiles = 2 ** 18;
  return {
    lon: ((x + dx + 0.5) / tiles) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / tiles))) * 180) / Math.PI,
  };
}

async function stop(
  deviceId: string,
  from: string,
  to: string,
  at: { lat: number; lon: number },
): Promise<void> {
  const seconds = (Date.parse(to) - Date.parse(from)) / 1000;
  await t.ctx.db.execute(sql`
    INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, confidence,
      distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
      centroid_lat, centroid_lon, features, version)
    VALUES (${deviceId}, ${from}::timestamptz, ${to}::timestamptz, 'stop', NULL, NULL, NULL,
      0, ${seconds}, 0, 10, ${at.lat}, ${at.lon}, ${at.lat}, ${at.lon},
      ${at.lat}, ${at.lon}, '{}'::jsonb, 2)
  `);
}

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ apiTokens: tokens });
  ({ agent: owner } = await signUpWithCookie(t.app, ownerEmail));
  const stranger = agentFor(t.app);
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");
  phone = (await createDevice(owner, { name: "Phone" })).device.id;
  tracker = (await createDevice(owner, { name: "Tracker" })).device.id;
  foreign = (await createDevice(stranger, { name: "Stranger's phone" })).device.id;
  const user = await t.ctx.db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE email = ${ownerEmail}`,
  );
  ownerId = user.rows[0]?.id ?? "";

  // Home: the phone 22:00–08:00 local on the 20th/21st, the tracker 00:00–10:00 (joined: 12 h),
  // the phone again 22:00 on the 22nd to 07:00 on the 23rd (9 h), and half an hour next door.
  await stop(phone, "2026-10-20T20:00:00Z", "2026-10-21T06:00:00Z", home);
  await stop(tracker, "2026-10-20T22:00:00Z", "2026-10-21T08:00:00Z", home);
  await stop(phone, "2026-10-22T20:00:00Z", "2026-10-23T05:00:00Z", home);
  await stop(phone, "2026-10-24T08:00:00Z", "2026-10-24T08:30:00Z", eastOf(home, 1));
  // A station's stop, an hour; a place on a named road, two hours.
  await stop(phone, "2026-10-21T10:00:00Z", "2026-10-21T11:00:00Z", {
    lat: station.lat + 20 / 111_195,
    lon: station.lon,
  });
  await stop(phone, "2026-10-23T12:00:00Z", "2026-10-23T14:00:00Z", street);
  // The stranger's own stay at home, which the owner never sees.
  await stop(foreign, "2026-10-20T08:00:00Z", "2026-10-20T20:00:00Z", home);

  // Map data: the station as a point of interest, and Kerkstraat under the phone when it arrived.
  const fetchedAt = "2026-10-01T00:00:00Z";
  await t.ctx.db.execute(sql`
    INSERT INTO osm_pois (id, source, kind, lat, lon, name, z, x, y, fetched_at)
    VALUES ('n1', 'overpass', 'station', ${station.lat}, ${station.lon}, 'Gent-Sint-Pieters', 14,
      ${tileX(station.lon)}, ${tileY(station.lat)}, ${fetchedAt}::timestamptz)
  `);
  await t.ctx.db.execute(sql`
    INSERT INTO locations (device_id, recorded_at, lat, lon)
    VALUES (${phone}, '2026-10-23T11:59:30Z', ${street.lat}, ${street.lon})
  `);
  await t.ctx.db.execute(sql`
    INSERT INTO processed_points (device_id, recorded_at, kept, lat_avg, lon_avg, way_id, version)
    VALUES (${phone}, '2026-10-23T11:59:30Z', true, ${street.lat}, ${street.lon}, 777, 1)
  `);
  await t.ctx.db.execute(sql`
    INSERT INTO osm_ways (id, source, kind, tags, nodes, geometry, min_lat, min_lon, max_lat,
      max_lon, fetched_at)
    VALUES (777, 'overpass', 'residential', '{"name":"Kerkstraat","highway":"residential"}'::jsonb,
      '{1,2}'::bigint[], ''::bytea, 51.14, 3.79, 51.16, 3.81, ${fetchedAt}::timestamptz)
  `);
});

afterAll(async () => {
  await t.close();
});

function tileX(lon: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** 14);
}
function tileY(lat: number): number {
  const radians = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** 14,
  );
}

const issue = async (
  scopes: Parameters<typeof tokenPrincipal>[2]["scopes"],
  deviceIds: string[] | null = null,
) => `Bearer ${tokens.issue(await tokenPrincipal(t.ctx.db, ownerEmail, { scopes, deviceIds }))}`;

const places = async (query: Record<string, string> = week) =>
  insightsPlacesSchema.parse(
    (await owner.get(apiPaths.v1.insights.places).query(query).expect(200)).body,
  );

describe("GET /api/v1/insights/places", () => {
  it("adds the stops up by place, devices joined, with names from the map data", async () => {
    const answer = await places();
    expect(answer.timezone).toBe("Europe/Brussels");
    expect(answer.period.days).toBe(7);
    expect(answer.totals).toEqual({ places: 3, durationS: 21.5 * 3600 + 3 * 3600, visits: 5 });
    const [homePlace, streetPlace, stationPlace] = answer.places;
    // Home: 12 h joined + 9 h + the half hour next door, folded in.
    expect(homePlace).toMatchObject({
      key: placeCellOf(home.lat, home.lon),
      durationS: 21.5 * 3600,
      visits: 3,
      days: 5,
      name: null,
    });
    expect(homePlace?.centre[0]).toBeCloseTo(home.lon, 3);
    expect(homePlace?.centre[1]).toBeCloseTo(home.lat, 3);
    expect(streetPlace).toMatchObject({
      durationS: 2 * 3600,
      visits: 1,
      name: { text: "Kerkstraat", source: "road", kind: null, distanceM: 0 },
    });
    expect(stationPlace).toMatchObject({
      durationS: 3600,
      name: { text: "Gent-Sint-Pieters", source: "stop", kind: "station" },
    });
    // The centre is rounded to four decimals (about 10 m): the stop is near 20 m, not exactly.
    expect(stationPlace?.name?.distanceM).toBeGreaterThanOrEqual(10);
    expect(stationPlace?.name?.distanceM).toBeLessThanOrEqual(30);
    expect(answer.rest).toEqual({ places: 0, durationS: 0, visits: 0 });
    // Four decimals at most, and nobody else's stay.
    for (const place of answer.places) {
      for (const value of place.centre)
        expect(String(value).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
    }
  });

  it("is limited to the devices asked for, and a stranger's device is a 404", async () => {
    const trackerOnly = await places({ ...week, devices: tracker });
    expect(trackerOnly.totals).toMatchObject({ places: 1, durationS: 10 * 3600 });
    const refused = await owner
      .get(apiPaths.v1.insights.places)
      .query({ ...week, devices: foreign })
      .expect(404);
    expect(errorOf(refused.body).code).toBe("not_found");
  });

  it("answers an empty period, and refuses one over three years", async () => {
    const empty = await places({ from: "2026-09-01", to: "2026-09-07" });
    expect(empty.places).toEqual([]);
    expect(empty.totals).toEqual({ places: 0, durationS: 0, visits: 0 });
    const long = await owner
      .get(apiPaths.v1.insights.places)
      .query({ from: "2022-10-01", to: "2026-10-25" })
      .expect(400);
    expect(errorOf(long.body).code).toBe("validation_failed");
  });
});

describe("GET /api/v1/insights/place", () => {
  const homeKey = placeCellOf(home.lat, home.lon);
  const place = async (key: string, query: Record<string, string> = week) =>
    insightsPlaceSchema.parse(
      (
        await owner
          .get(apiPaths.v1.insights.place)
          .query({ ...query, place: key })
          .expect(200)
      ).body,
    );

  it("tells one place by step and day, newest first", async () => {
    const answer = await place(homeKey);
    expect(answer.place).toMatchObject({
      key: homeKey,
      durationS: 21.5 * 3600,
      cells: 2,
      visits: 3,
    });
    expect(answer.period.bucket).toBe("day");
    expect(answer.series).toHaveLength(7);
    expect(answer.series.reduce((sum, step) => sum + step.durationS, 0)).toBe(21.5 * 3600);
    expect(answer.days.map((day) => day.date)).toEqual([
      "2026-10-24",
      "2026-10-23",
      "2026-10-22",
      "2026-10-21",
      "2026-10-20",
    ]);
    // 22:00–24:00 on the 20th, 00:00–10:00 on the 21st (the tracker stayed on).
    const byDate = Object.fromEntries(answer.days.map((day) => [day.date, day]));
    expect(byDate["2026-10-20"]?.durationS).toBe(2 * 3600);
    expect(byDate["2026-10-21"]?.durationS).toBe(10 * 3600);
    expect(byDate["2026-10-20"]?.visits).toBe(1);
    expect(byDate["2026-10-21"]?.visits).toBe(0);
  });

  it("resolves a folded cell to its place, and gives null for a key without stays", async () => {
    const folded = placeCellOf(eastOf(home, 1).lat, eastOf(home, 1).lon);
    expect(folded).not.toBe(homeKey);
    const answer = await place(folded);
    expect(answer.place?.key).toBe(homeKey);
    const nobody = await place("1.1");
    expect(nobody.place).toBeNull();
    expect(nobody.days).toEqual([]);
    expect(nobody.series.every((step) => step.durationS === 0)).toBe(true);
  });

  it("refuses a key that is no cell of the grid", async () => {
    for (const bad of ["abc", "1", "999999.1", "262144.0", "1.2.3", "../1.1", "-1.1"]) {
      await owner
        .get(apiPaths.v1.insights.place)
        .query({ ...week, place: bad })
        .expect(400);
    }
  });
});

describe("ETags", () => {
  const ask = (etag?: string) => {
    const pending = owner.get(apiPaths.v1.insights.places).query(week);
    return etag === undefined ? pending : pending.set("If-None-Match", etag);
  };

  it("answers 304 to its own, and a new one after a change of stops or of map data", async () => {
    const first = await ask().expect(200);
    const etag = String(first.headers["etag"]);
    await ask(etag).expect(304);
    await stop(tracker, "2026-10-24T10:00:00Z", "2026-10-24T11:00:00Z", station);
    const afterStop = await ask(etag).expect(200);
    const second = String(afterStop.headers["etag"]);
    expect(second).not.toBe(etag);
    await ask(second).expect(304);
    // A tile fetched since changes the names the answer may carry.
    await t.ctx.db.execute(sql`
      INSERT INTO osm_tiles (z, x, y, status, fetched_at, way_count, poi_count, bytes)
      VALUES (14, 1, 1, 'ok', now() + interval '1 hour', 0, 0, 1)
    `);
    const afterMap = await ask(second).expect(200);
    expect(String(afterMap.headers["etag"])).not.toBe(second);
  });
});

describe("who may read Places", () => {
  const operations = [apiPaths.v1.insights.places, apiPaths.v1.insights.place];
  const query = { ...week, place: "134217.89012" };

  it("needs locations:read: history:read alone is refused", async () => {
    const history = await issue(["history:read"]);
    const locations = await issue(["locations:read"]);
    for (const path of operations) {
      const refused = await request(t.app)
        .get(path)
        .query(query)
        .set("Authorization", history)
        .expect(403);
      expect(errorOf(refused.body).code).toBe("insufficient_scope");
      await request(t.app).get(path).query(query).set("Authorization", locations).expect(200);
      await request(t.app).get(path).query(query).expect(401);
    }
  });

  it("keeps a token to its devices", async () => {
    const trackerOnly = await issue(["locations:read"], [tracker]);
    const answer = insightsPlacesSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.v1.insights.places)
          .query(week)
          .set("Authorization", trackerOnly)
          .expect(200)
      ).body,
    );
    expect(answer.totals.durationS).toBeLessThanOrEqual(11 * 3600);
    await request(t.app)
      .get(apiPaths.v1.insights.places)
      .query({ ...week, devices: phone })
      .set("Authorization", trackerOnly)
      .expect(404);
  });
});

describe("what the access log keeps", () => {
  it("is the period and devices of a request, never the place or a coordinate", async () => {
    // What the earlier requests left in the buffer goes first, then the log is cleared.
    await t.ctx.background.drain(5000);
    await t.ctx.dataAccess.flush();
    await t.ctx.db.execute(sql`DELETE FROM data_access_events`);
    const token = await issue(["locations:read"]);
    const key = placeCellOf(home.lat, home.lon);
    await request(t.app)
      .get(apiPaths.v1.insights.places)
      .query({ ...week, devices: phone })
      .set("Authorization", token)
      .expect(200);
    await request(t.app)
      .get(apiPaths.v1.insights.place)
      .query({ ...week, place: key })
      .set("Authorization", token)
      .expect(200);
    await t.ctx.background.drain(5000);
    await t.ctx.dataAccess.flush();
    const { rows } = await t.ctx.db.execute<{ action: string; resource: unknown }>(sql`
      SELECT action, resource FROM data_access_events WHERE owner_user_id = ${ownerId} ORDER BY id
    `);
    expect(rows.map((row) => row.action).sort()).toEqual(["getInsightsPlace", "getInsightsPlaces"]);
    const of = (action: string) => rows.find((row) => row.action === action)?.resource;
    expect(of("getInsightsPlaces")).toEqual({ ...week, deviceIds: [phone] });
    expect(of("getInsightsPlace")).toEqual(week);
    const logged = JSON.stringify(rows);
    expect(logged).not.toContain(key);
    expect(logged).not.toContain("place");
    // No number that reads as a coordinate (a decimal fraction) in what was kept.
    expect(logged).not.toMatch(/\d\.\d{3,}/);
  });
});
