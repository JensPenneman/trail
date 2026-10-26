import { apiPaths } from "@trail/contracts/apiPaths";
import type { ApiScope } from "@trail/contracts/apiScope";
import { tokenVerificationSchema } from "@trail/contracts/apiToken";
import { deviceResponseSchema } from "@trail/contracts/device";
import { deviceUpdateResponseSchema } from "@trail/contracts/devicePublic";
import { apiErrorSchema } from "@trail/contracts/errors";
import { heatmapPublicResponseSchema } from "@trail/contracts/heatmapPublic";
import { locationsPageSchema } from "@trail/contracts/location";
import { pointPageSchema, pointSchema } from "@trail/contracts/locationPublic";
import { activityResponseSchema, dayStatsResponseSchema } from "@trail/contracts/statsPublic";
import { tripsPublicResponseSchema } from "@trail/contracts/tripPublic";
import { visitsPublicResponseSchema } from "@trail/contracts/visitPublic";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createApiToken } from "../support/apiTokenFlows";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * The v1 operations of the token branch, called with real API tokens: their
 * answers match the dashboard's private routes, and every one keeps to the
 * token's scopes and devices.
 */
let t: TestContext;
let owner: Agent;
let stranger: Agent;
let ride = "";
let dense = "";
let foreign = "";

const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;
const query = (values: Record<string, string | number>) =>
  new URLSearchParams(
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
  ).toString();
const twoDays = { from: "2026-09-28T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" };

/** One point a second from `start`, in a line. */
const line = (count: number, start: string) => ({
  locations: Array.from({ length: count }, (_, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [3.6 + index * 0.00005, 51.0 + index * 0.00002] },
    properties: {
      timestamp: new Date(Date.parse(start) + index * 1000).toISOString().replace(".000Z", "Z"),
      horizontal_accuracy: 5,
      speed: 4,
    },
  })),
});

const tokens: Record<string, string> = {};
const issue = async (name: string, scopes: ApiScope[], deviceIds: string[] | null = null) => {
  tokens[name] = (await createApiToken(owner, { name, scopes, deviceIds, expiresAt: null })).secret;
};
/** A GET with the named token. */
const as = (name: string, path: string) =>
  request(t.app)
    .get(path)
    .set("Authorization", bearer(tokens[name] ?? ""));

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  stranger = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");
  const rideDevice = await createDevice(owner, { name: "iPhone" });
  const denseDevice = await createDevice(owner, { name: "Bike computer" });
  const foreignDevice = await createDevice(stranger, { name: "Stranger's phone" });
  ride = rideDevice.device.id;
  dense = denseDevice.device.id;
  foreign = foreignDevice.device.id;
  await postOverland(t.app, rideDevice.credentials.accessToken, overlandFixture()).expect(200);
  await postOverland(
    t.app,
    denseDevice.credentials.accessToken,
    line(1200, "2026-09-29T12:00:00Z"),
  ).expect(200);
  await postOverland(t.app, foreignDevice.credentials.accessToken, overlandFixture()).expect(200);
  // A point from ten minutes ago for the activity chart.
  await postOverland(t.app, rideDevice.credentials.accessToken, {
    locations: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [3.7174, 51.0543] },
        properties: {
          timestamp: new Date(Date.now() - 600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
          horizontal_accuracy: 12,
        },
      },
    ],
  }).expect(200);
  await t.ctx.dailyStats.flush();

  await issue("full", ["devices:read", "devices:write", "locations:read", "history:read"]);
  await issue("rideOnly", ["devices:write", "locations:read", "history:read"], [ride]);
  await issue("profileOnly", ["profile:read"]);
  await issue("devicesRead", ["devices:read"]);
  await issue("writer", ["devices:write"]);
  await issue("historyOnly", ["history:read"]);
  await issue("locationsOnly", ["locations:read"]);
});

afterAll(async () => {
  await t.close();
});

describe("GET /api/v1/tokens/verify", () => {
  it("describes the calling token, whatever its scopes", async () => {
    const response = await as("profileOnly", apiPaths.v1.tokens.verify).expect(200);
    expect(tokenVerificationSchema.parse(response.body)).toMatchObject({
      name: "profileOnly",
      scopes: ["profile:read"],
      deviceIds: null,
      expiresAt: null,
      status: "active",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("tells a session that it has no token to verify (400), and asks for one without (401)", async () => {
    const session = await owner.get(apiPaths.v1.tokens.verify).expect(400);
    expect(errorOf(session.body).code).toBe("bad_request");
    expect(errorOf(session.body).message).toContain("Authorization: Bearer");
    const anonymous = await request(t.app).get(apiPaths.v1.tokens.verify).expect(401);
    expect(errorOf(anonymous.body).code).toBe("unauthorized");
    expect(anonymous.headers["www-authenticate"]).toBe('Bearer realm="trail"');
  });
});

describe("PATCH /api/v1/devices/{id}", () => {
  const patch = (name: string, deviceId: string, body: object) =>
    request(t.app)
      .patch(apiPaths.v1.devices.one(deviceId))
      .set("Authorization", bearer(tokens[name] ?? ""))
      .send(body);

  it("renames, switches alerts and queues a preset, as the dashboard sees it", async () => {
    const response = await patch("writer", dense, {
      name: "Road bike",
      alertsEnabled: false,
      pendingSettings: "high-resolution",
    }).expect(200);
    const { device, settings } = deviceUpdateResponseSchema.parse(response.body);
    expect(device).toMatchObject({ id: dense, name: "Road bike" });
    expect(settings).toEqual({
      alertsEnabled: false,
      pendingSettings: "high-resolution",
      settingsAppliedAt: null,
    });
    const summary = deviceResponseSchema.parse(
      (await owner.get(apiPaths.devices.one(dense)).expect(200)).body,
    ).device;
    expect(summary).toMatchObject({
      name: "Road bike",
      alertsEnabled: false,
      pendingSettings: "high-resolution",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/tokenHint|deviceKey/);

    const undone = await patch("writer", dense, {
      pendingSettings: null,
      alertsEnabled: true,
    }).expect(200);
    expect(deviceUpdateResponseSchema.parse(undone.body).settings).toMatchObject({
      alertsEnabled: true,
      pendingSettings: null,
    });
  });

  it("shows the device's position only with locations:read", async () => {
    const without = deviceUpdateResponseSchema.parse(
      (await patch("writer", ride, { name: "iPhone" }).expect(200)).body,
    );
    expect(without.device).not.toHaveProperty("lastLocation");
    expect(without.device.battery).not.toBeNull();
    const withScope = deviceUpdateResponseSchema.parse(
      (await patch("full", ride, { name: "iPhone" }).expect(200)).body,
    );
    expect(withScope.device.lastLocation).toMatchObject({ lat: expect.any(Number) });
  });

  it("changes nothing else: never the token, never a deletion", async () => {
    const before = deviceResponseSchema.parse(
      (await owner.get(apiPaths.devices.one(ride)).expect(200)).body,
    ).device;
    // Unknown fields are dropped, which leaves nothing to change.
    const ignored = await patch("writer", ride, { tokenHint: "abcd", deviceKey: "stolen" }).expect(
      400,
    );
    expect(errorOf(ignored.body).code).toBe("validation_failed");
    for (const call of [
      request(t.app).delete(apiPaths.v1.devices.one(ride)),
      request(t.app).post(`${apiPaths.v1.devices.one(ride)}/token`),
    ]) {
      const response = await call.set("Authorization", bearer(tokens["writer"] ?? "")).expect(404);
      expect(errorOf(response.body).message).toBe("No such API route.");
    }
    const after = deviceResponseSchema.parse(
      (await owner.get(apiPaths.devices.one(ride)).expect(200)).body,
    ).device;
    expect(after).toMatchObject({ tokenHint: before.tokenHint, deviceKey: before.deviceKey });
  });

  it("needs devices:write, the token's devices and the account's own device", async () => {
    const refused = await patch("devicesRead", ride, { name: "x" }).expect(403);
    expect(errorOf(refused.body)).toMatchObject({ code: "insufficient_scope" });
    expect(errorOf(refused.body).message).toContain("devices:write");
    await patch("rideOnly", dense, { name: "x" }).expect(404);
    await patch("writer", foreign, { name: "x" }).expect(404);
    await patch("writer", "not-a-uuid", { name: "x" }).expect(404);
    for (const body of [{}, { name: "" }, { pendingSettings: "turbo" }]) {
      expect(errorOf((await patch("writer", ride, body).expect(400)).body).code).toBe(
        "validation_failed",
      );
    }
  });

  it("refuses revoked and expired tokens", async () => {
    const revoked = await createApiToken(owner, {
      name: "Revoked writer",
      scopes: ["devices:write"],
      expiresAt: null,
    });
    await owner.delete(apiPaths.me.token(revoked.token.id)).set("Origin", testOrigin).expect(204);
    const expired = await createApiToken(owner, {
      name: "Expired writer",
      scopes: ["devices:write"],
      expiresAt: null,
    });
    await t.ctx.db.execute(
      sql`UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = ${expired.token.id}`,
    );
    for (const [secret, code] of [
      [revoked.secret, "unauthorized"],
      [expired.secret, "token_expired"],
    ] as const) {
      const response = await request(t.app)
        .patch(apiPaths.v1.devices.one(ride))
        .set("Authorization", bearer(secret))
        .send({ name: "Not allowed" })
        .expect(401);
      expect(errorOf(response.body).code).toBe(code);
      expect(response.headers["www-authenticate"]).toBe(
        'Bearer realm="trail", error="invalid_token"',
      );
    }
    const summary = deviceResponseSchema.parse(
      (await owner.get(apiPaths.devices.one(ride)).expect(200)).body,
    ).device;
    expect(summary.name).not.toBe("Not allowed");
  });

  it("works with the session too, behind the CSRF guard", async () => {
    await owner
      .patch(apiPaths.v1.devices.one(ride))
      .set("Origin", testOrigin)
      .send({ name: "iPhone" })
      .expect(200);
    const forged = await owner
      .patch(apiPaths.v1.devices.one(ride))
      .set("Origin", "https://evil.example")
      .send({ name: "Hijacked" })
      .expect(403);
    expect(errorOf(forged.body).code).toBe("origin_not_allowed");
  });
});

describe("GET /api/v1/locations", () => {
  it("pages one device's raw points oldest first, exactly as stored", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await as(
        "full",
        `${apiPaths.v1.locations}?${query({ device: ride, ...twoDays, limit: 7, ...(cursor === null ? {} : { cursor }) })}`,
      ).expect(200);
      const page = pointPageSchema.parse(response.body);
      seen.push(...page.items.map((point) => point.recordedAt));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(5);
    expect(seen).toHaveLength(30);
    expect(seen).toEqual([...seen].sort());
    expect(new Set(seen).size).toBe(30);

    // The same points as the dashboard's raw list, which pages newest first.
    const dashboard = locationsPageSchema.parse(
      (
        await owner
          .get(`${apiPaths.locations}?${query({ deviceId: ride, before: twoDays.to, limit: 30 })}`)
          .expect(200)
      ).body,
    );
    const first = pointPageSchema.parse(
      (
        await as(
          "full",
          `${apiPaths.v1.locations}?${query({ device: ride, ...twoDays, limit: 1 })}`,
        ).expect(200)
      ).body,
    ).items[0];
    const oldest = dashboard.items.at(-1);
    expect(first).toMatchObject({
      deviceId: ride,
      recordedAt: oldest?.recordedAt,
      receivedAt: oldest?.receivedAt,
      lat: oldest?.lat,
      lon: oldest?.lon,
      accuracy: oldest?.accuracy,
      speed: oldest?.speed,
      motion: oldest?.motion,
    });
    expect(first?.battery?.level).toBe(oldest?.batteryLevel);
  });

  it("leaves out what is not documented: the Wi-Fi network and Overland's other properties", async () => {
    // The fixture's points carry a Wi-Fi network and Overland's ids (`extra`) on the server.
    const stored = locationsPageSchema.parse(
      (await owner.get(`${apiPaths.locations}?${query({ deviceId: ride, limit: 30 })}`).expect(200))
        .body,
    ).items;
    expect(stored.some((point) => point.wifi !== null && point.extra !== null)).toBe(true);
    const response = await as(
      "full",
      `${apiPaths.v1.locations}?${query({ device: ride, limit: 1000 })}`,
    ).expect(200);
    for (const point of response.body.items) {
      expect(Object.keys(point).sort()).toEqual(Object.keys(pointSchema.shape).sort());
    }
    expect(JSON.stringify(response.body)).not.toMatch(/wifi|extra|unique_id|device_id|Telenet/);
  });

  it("reads an empty cursor as the first page", async () => {
    const page = (cursor?: string) =>
      as(
        "full",
        `${apiPaths.v1.locations}?${query({ device: ride, limit: 3, ...(cursor === undefined ? {} : { cursor }) })}`,
      ).expect(200);
    expect((await page("")).body).toEqual((await page()).body);
  });

  it("takes from and to with any offset, half-open", async () => {
    const response = await as(
      "full",
      `${apiPaths.v1.locations}?${query({
        device: ride,
        from: "2026-09-29T08:30:15+02:00",
        to: "2026-09-29T08:31:00+02:00",
      })}`,
    ).expect(200);
    const { items } = pointPageSchema.parse(response.body);
    expect(items[0]?.recordedAt).toBe("2026-09-29T06:30:15.000Z");
    expect(items.every((point) => point.recordedAt < "2026-09-29T06:31:00.000Z")).toBe(true);
  });

  it("serves up to 1000 points a page", async () => {
    const full = pointPageSchema.parse(
      (
        await as(
          "full",
          `${apiPaths.v1.locations}?${query({ device: dense, limit: 1000 })}`,
        ).expect(200)
      ).body,
    );
    expect(full.items).toHaveLength(1000);
    expect(full.nextCursor).not.toBeNull();
    const rest = pointPageSchema.parse(
      (
        await as(
          "full",
          `${apiPaths.v1.locations}?${query({ device: dense, limit: 1000, cursor: full.nextCursor ?? "" })}`,
        ).expect(200)
      ).body,
    );
    expect(rest.items).toHaveLength(200);
    expect(rest.nextCursor).toBeNull();
    expect(rest.items[0]?.recordedAt).toBe("2026-09-29T12:16:40.000Z");
  });

  it("refuses bad input, other devices and a missing scope", async () => {
    for (const values of [
      {},
      { device: ride, limit: 1001 },
      { device: ride, limit: 0 },
      { device: ride, cursor: "not-a-cursor" },
      { device: ride, from: "2026-09-29", to: "2026-09-30" },
      { device: ride, from: twoDays.to, to: twoDays.from },
    ]) {
      const response = await as("full", `${apiPaths.v1.locations}?${query(values)}`).expect(400);
      expect(errorOf(response.body).code, JSON.stringify(values)).toBe("validation_failed");
    }
    await as("full", `${apiPaths.v1.locations}?${query({ device: foreign })}`).expect(404);
    await as("rideOnly", `${apiPaths.v1.locations}?${query({ device: dense })}`).expect(404);
    await as("rideOnly", `${apiPaths.v1.locations}?${query({ device: ride })}`).expect(200);
    const refused = await as(
      "devicesRead",
      `${apiPaths.v1.locations}?${query({ device: ride })}`,
    ).expect(403);
    expect(errorOf(refused.body).message).toContain("locations:read");
  });
});

describe("history", () => {
  it("lists visits and trips like the dashboard", async () => {
    const visits = visitsPublicResponseSchema.parse(
      (await as("full", `${apiPaths.v1.visits}?${query(twoDays)}`).expect(200)).body,
    );
    expect(visits.visits).toEqual(
      (await owner.get(`${apiPaths.visits}?${query(twoDays)}`)).body.visits,
    );
    expect(visits.visits).toEqual([
      {
        deviceId: ride,
        recordedAt: "2026-09-29T06:29:10.000Z",
        arrivedAt: "2026-09-28T17:48:12.000Z",
        departedAt: "2026-09-29T06:29:05.000Z",
        lat: 51.0445,
        lon: 3.725,
        accuracy: 35,
      },
    ]);
    const trips = tripsPublicResponseSchema.parse(
      (await as("full", `${apiPaths.v1.trips}?${query({ ...twoDays, devices: ride })}`).expect(200))
        .body,
    );
    expect(trips.trips).toEqual(
      (await owner.get(`${apiPaths.trips}?${query(twoDays)}`)).body.trips,
    );
    expect(trips.trips).toHaveLength(1);
  });

  it("has the daily statistics, activity and heatmap of the dashboard", async () => {
    const days = { from: "2026-09-28", to: "2026-09-29" };
    const stats = dayStatsResponseSchema.parse(
      (await as("full", `${apiPaths.v1.stats.days}?${query(days)}`).expect(200)).body,
    );
    expect(stats).toEqual((await owner.get(`${apiPaths.statsDays}?${query(days)}`)).body);
    expect(stats.timezone).toBe("Europe/Brussels");
    expect(stats.days.map((day) => [day.date, day.deviceId])).toEqual([
      ["2026-09-29", ride],
      ["2026-09-29", dense],
    ]);

    const activity = activityResponseSchema.parse(
      (await as("full", `${apiPaths.v1.stats.activity}?${query({ hours: 3 })}`).expect(200)).body,
    );
    expect(activity.buckets).toHaveLength(6);
    expect(activity.buckets.reduce((sum, bucket) => sum + bucket.recorded, 0)).toBe(1);

    const viewport = { bbox: "3.4,50.9,3.8,51.1", zoom: 11 };
    const heatmap = heatmapPublicResponseSchema.parse(
      (await as("full", `${apiPaths.v1.heatmap}?${query(viewport)}`).expect(200)).body,
    );
    expect(heatmap).toEqual(
      (await owner.get(`${apiPaths.heatmap}?${query(viewport)}`).expect(200)).body,
    );
    expect(heatmap.cells.reduce((sum, cell) => sum + cell[2], 0)).toBe(31 + 1200);
  });

  it("keeps a token to its devices, everywhere", async () => {
    const get = (path: string) => as("rideOnly", path).expect(200);
    const days = { from: "2026-09-28", to: "2026-09-29" };
    const stats = dayStatsResponseSchema.parse(
      (await get(`${apiPaths.v1.stats.days}?${query(days)}`)).body,
    );
    expect(stats.days.map((day) => day.deviceId)).toEqual([ride]);
    const activity = activityResponseSchema.parse(
      (await get(`${apiPaths.v1.stats.activity}?${query({ hours: 2 })}`)).body,
    );
    expect(new Set(activity.buckets.map((bucket) => bucket.deviceId))).toEqual(new Set([ride]));
    const heatmap = heatmapPublicResponseSchema.parse(
      (await get(`${apiPaths.v1.heatmap}?${query({ bbox: "3.4,50.9,3.8,51.1", zoom: 11 })}`)).body,
    );
    expect(heatmap.cells.reduce((sum, cell) => sum + cell[2], 0)).toBe(31);
    const trips = tripsPublicResponseSchema.parse(
      (await get(`${apiPaths.v1.trips}?${query(twoDays)}`)).body,
    );
    expect(trips.trips.map((trip) => trip.deviceId)).toEqual([ride]);

    for (const path of [
      `${apiPaths.v1.visits}?${query({ ...twoDays, devices: dense })}`,
      `${apiPaths.v1.trips}?${query({ ...twoDays, devices: `${ride},${dense}` })}`,
      `${apiPaths.v1.stats.days}?${query({ ...days, devices: dense })}`,
      `${apiPaths.v1.stats.activity}?${query({ devices: dense })}`,
      `${apiPaths.v1.heatmap}?${query({ bbox: "3.4,50.9,3.8,51.1", zoom: 11, devices: dense })}`,
    ]) {
      expect(errorOf((await as("rideOnly", path).expect(404)).body).code, path).toBe("not_found");
    }
  });

  it("never shows another account's devices", async () => {
    for (const path of [
      `${apiPaths.v1.visits}?${query({ ...twoDays, devices: foreign })}`,
      `${apiPaths.v1.stats.days}?${query({ from: "2026-09-28", to: "2026-09-29", devices: foreign })}`,
      `${apiPaths.v1.heatmap}?${query({ bbox: "3.4,50.9,3.8,51.1", zoom: 11, devices: foreign })}`,
    ]) {
      await as("full", path).expect(404);
    }
    const visits = visitsPublicResponseSchema.parse(
      (await as("full", `${apiPaths.v1.visits}?${query(twoDays)}`).expect(200)).body,
    );
    expect(visits.visits.map((visit) => visit.deviceId)).not.toContain(foreign);
  });

  it("needs locations:read for what has coordinates and history:read for the rest", async () => {
    const days = { from: "2026-09-28", to: "2026-09-29" };
    const withCoordinates = [
      `${apiPaths.v1.visits}?${query(twoDays)}`,
      `${apiPaths.v1.heatmap}?${query({ bbox: "3.4,50.9,3.8,51.1", zoom: 11 })}`,
    ];
    const withoutCoordinates = [
      `${apiPaths.v1.trips}?${query(twoDays)}`,
      `${apiPaths.v1.stats.days}?${query(days)}`,
      `${apiPaths.v1.stats.activity}`,
    ];
    // A history-only token: the trips and the statistics, never a place.
    for (const path of withCoordinates) {
      const refused = await as("historyOnly", path).expect(403);
      expect(errorOf(refused.body), path).toMatchObject({ code: "insufficient_scope" });
      expect(errorOf(refused.body).message, path).toContain("locations:read");
      expect(refused.headers["www-authenticate"]).toContain('scope="locations:read"');
    }
    for (const path of withoutCoordinates) await as("historyOnly", path).expect(200);
    // A locations-only token: the places, not the coordinate-free history.
    for (const path of withCoordinates) await as("locationsOnly", path).expect(200);
    for (const path of withoutCoordinates) {
      const refused = await as("locationsOnly", path).expect(403);
      expect(errorOf(refused.body).message, path).toContain("history:read");
    }
  });

  it("validates its ranges", async () => {
    for (const path of [
      `${apiPaths.v1.visits}?${query({ from: "2025-01-01T00:00:00Z", to: "2026-09-30T00:00:00Z" })}`,
      `${apiPaths.v1.trips}?${query({ from: twoDays.to, to: twoDays.from })}`,
      `${apiPaths.v1.visits}?${query({ ...twoDays, devices: "phone" })}`,
      `${apiPaths.v1.stats.days}?${query({ from: "2026-09-29", to: "2026-09-28" })}`,
      `${apiPaths.v1.stats.activity}?${query({ hours: 169 })}`,
      `${apiPaths.v1.heatmap}?${query({ bbox: "3.4,50.9,3.8", zoom: 11 })}`,
    ]) {
      expect(errorOf((await as("full", path).expect(400)).body).code, path).toBe(
        "validation_failed",
      );
    }
  });
});
