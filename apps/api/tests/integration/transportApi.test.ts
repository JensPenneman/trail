import { apiPaths } from "@trail/contracts/apiPaths";
import { apiErrorSchema } from "@trail/contracts/errors";
import {
  deviceModeResponseSchema,
  levelTracksResponseSchema,
  modeStatsResponseSchema,
  segmentResponseSchema,
  timelineResponseSchema,
} from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, agentFor, signUp, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FakeApiTokens, tokenPrincipal } from "../support/fakeApiTokens";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive, sparseTrain } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { SseClient } from "../support/sseClient";
import { concat, lastT, stay, travel } from "../support/syntheticWorld";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * The v1 operations of processing: tracks at a level, the timeline, the
 * corrections and the per-mode statistics — with the session, with API tokens
 * (scopes, device restrictions) and against other people's ids.
 */
let t: TestContext;
const tokens = new FakeApiTokens();
let owner: Agent;
let ownerCookie = "";
let stranger: Agent;
let train = "";
let drive = "";
let foreign = "";

const ownerEmail = "first@example.com";
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();
const day = { from: iso(morning - 6 * 3600), to: iso(morning + 18 * 3600) };
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: new FixtureWaySource(), apiTokens: tokens });
  ({ agent: owner, cookie: ownerCookie } = await signUpWithCookie(t.app, ownerEmail));
  stranger = agentFor(t.app);
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");
  const commuter = await createDevice(owner, { name: "Commuter" });
  const car = await createDevice(owner, { name: "Car phone" });
  const theirs = await createDevice(stranger, { name: "Stranger's phone" });
  train = commuter.device.id;
  drive = car.device.id;
  foreign = theirs.device.id;
  await uploadJourney(t.app, commuter.credentials.accessToken, sparseTrain());
  await uploadJourney(t.app, car.credentials.accessToken, motorwayDrive(morning + 4 * 3600));
  await uploadJourney(t.app, theirs.credentials.accessToken, motorwayDrive(morning));
  await t.ctx.background.drain(5000);
  await t.ctx.processing.flush();
});

afterAll(async () => {
  await t.close();
});

const issue = async (
  scopes: Parameters<typeof tokenPrincipal>[2]["scopes"],
  deviceIds: string[] | null = null,
) => `Bearer ${tokens.issue(await tokenPrincipal(t.ctx.db, ownerEmail, { scopes, deviceIds }))}`;

const timeline = async (agent: Agent, query: Record<string, string | number> = {}) =>
  timelineResponseSchema.parse(
    (
      await agent
        .get(apiPaths.v1.segments.root)
        .query({ ...day, ...query })
        .expect(200)
    ).body,
  );

async function trainMove() {
  const { items } = await timeline(owner, { devices: train });
  const move = items.find((segment) => segment.kind === "move");
  if (move === undefined) throw new Error("the train journey has no move");
  return move;
}

describe("GET /api/v1/tracks", () => {
  it("serves the session's devices at the asked level", async () => {
    const response = await owner
      .get(apiPaths.v1.tracks)
      .query({ ...day, level: "inferred" })
      .expect(200);
    const tracks = levelTracksResponseSchema.parse(response.body);
    expect(tracks.level).toBe("inferred");
    expect(tracks.availableLevel).toBe("inferred");
    expect(new Set(tracks.segments.map((segment) => segment.deviceId))).toEqual(
      new Set([train, drive]),
    );
    expect(
      tracks.segments.filter((segment) => segment.kind === "move").map((segment) => segment.mode),
    ).toEqual(["train", "car"]);
    for (const segment of tracks.segments) {
      for (const point of segment.points) expect(point).toHaveLength(3);
    }
  });

  it("gives a stop its place and the points within it, simplified with the rest", async () => {
    const inferred = levelTracksResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.tracks)
          .query({ ...day, devices: train, level: "inferred" })
          .expect(200)
      ).body,
    );
    const { items } = await timeline(owner, { devices: train });
    expect(inferred.segments.map((segment) => segment.kind)).toEqual(["stop", "move", "stop"]);
    for (const [index, segment] of inferred.segments.entries()) {
      const listed = items[index];
      if (segment.kind === "stop") {
        // The dot's place is the timeline's, and the stop's points are served like a move's.
        expect(segment.centroid).toEqual(listed?.centroid);
        expect(segment.points.length).toBeGreaterThan(1);
      } else {
        expect(segment.centroid).toBeNull();
      }
    }
    // Consecutive segments meet: the stop's last point is the move's first.
    const [platform, ride] = inferred.segments;
    expect(platform?.points.at(-1)).toEqual(ride?.points[0]);
    // The other levels have no stops, so no places.
    const mapped = levelTracksResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.tracks)
          .query({ ...day, devices: train, level: "mapped" })
          .expect(200)
      ).body,
    );
    expect(mapped.segments.every((segment) => segment.centroid === null)).toBe(true);
    // Simplified to maxPoints with everything else, the stops' points included.
    const small = levelTracksResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.tracks)
          .query({ ...day, devices: train, level: "inferred", maxPoints: 100 })
          .expect(200)
      ).body,
    );
    expect(small.segments.flatMap((segment) => segment.points).length).toBeLessThanOrEqual(100);
    expect(small.segments.map((segment) => segment.kind)).toEqual(["stop", "move", "stop"]);
  });

  it("serves a stop its own points and spread: the point the phone resumed at is the move's", async () => {
    // Half an hour at the desk, ten minutes without a point, then riding from 150 m on.
    const device = await createDevice(owner, { name: "Resumer" });
    const start = morning + 9 * 3600;
    const desk = stay([-600, -400], { startT: start, durationS: 1800, intervalS: 10 });
    const ride = travel(
      [
        [-600, -250],
        [-600, 2000],
      ],
      { startT: lastT(desk) + 600, speedMs: 5, intervalS: 2, motion: ["cycling"] },
    );
    await uploadJourney(t.app, device.credentials.accessToken, concat(desk, ride));
    await t.ctx.background.drain(5000);
    await t.ctx.processing.flush();
    const tracks = levelTracksResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.tracks)
          .query({ ...day, devices: device.device.id, level: "inferred" })
          .expect(200)
      ).body,
    );
    const [stop, move] = tracks.segments;
    expect(tracks.segments.map((segment) => segment.kind)).toEqual(["stop", "move"]);
    // The stop lasted until the phone resumed; its points end at its own last one …
    expect(stop?.points.at(-1)?.[2]).toBe(lastT(desk));
    expect(Date.parse(stop?.endedAt ?? "") / 1000).toBe(lastT(desk) + 600);
    // … and the point it resumed at, 150 m on, starts the ride.
    expect(move?.points[0]?.[2]).toBe(lastT(desk) + 600);
    // Its spread is the timeline's: the desk, not the way to where the ride began.
    const { items } = await timeline(owner, { devices: device.device.id });
    expect(stop?.spreadM).toBe(items[0]?.spreadM);
    expect(stop?.spreadM).toBeLessThan(25);
    expect(move?.spreadM).toBeNull();
    await owner
      .delete(apiPaths.devices.one(device.device.id))
      .set("Origin", testOrigin)
      .expect(204);
  });

  it("defaults to raw, simplifies to maxPoints and refuses ranges over 93 days", async () => {
    const raw = levelTracksResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.tracks)
          .query({ ...day, devices: drive, maxPoints: 100 })
          .expect(200)
      ).body,
    );
    expect(raw.level).toBe("raw");
    expect(raw.simplified).toBe(true);
    expect(raw.segments.flatMap((segment) => segment.points).length).toBeLessThanOrEqual(100);
    const tooLong = await owner
      .get(apiPaths.v1.tracks)
      .query({ from: iso(morning - 100 * 86_400), to: iso(morning) })
      .expect(400);
    expect(errorOf(tooLong.body).code).toBe("validation_failed");
    await owner
      .get(apiPaths.v1.tracks)
      .query({ ...day, level: "best" })
      .expect(400);
  });

  it("answers 404 for another person's device and 403 without locations:read", async () => {
    const foreignTrack = await owner
      .get(apiPaths.v1.tracks)
      .query({ ...day, devices: foreign })
      .expect(404);
    expect(errorOf(foreignTrack.body).code).toBe("not_found");
    const noScope = await request(t.app)
      .get(apiPaths.v1.tracks)
      .query(day)
      .set("Authorization", await issue(["history:read"]))
      .expect(403);
    expect(errorOf(noScope.body).code).toBe("insufficient_scope");
    const limited = await issue(["locations:read"], [drive]);
    await request(t.app)
      .get(apiPaths.v1.tracks)
      .query({ ...day, devices: train })
      .set("Authorization", limited)
      .expect(404);
    const allowed = levelTracksResponseSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.v1.tracks)
          .query(day)
          .set("Authorization", limited)
          .expect(200)
      ).body,
    );
    expect(new Set(allowed.segments.map((segment) => segment.deviceId))).toEqual(new Set([drive]));
  });
});

describe("GET /api/v1/segments", () => {
  it("lists stops and moves oldest first, a page at a time", async () => {
    const all = await timeline(owner);
    expect(
      all.items.map((segment) => [segment.deviceId === train ? "train" : "car", segment.kind]),
    ).toEqual([
      ["train", "stop"],
      ["train", "move"],
      ["train", "stop"],
      ["car", "move"],
    ]);
    expect(all.pending).toBe(false);
    expect(all.nextCursor).toBeNull();
    const pages: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await timeline(owner, { limit: 1, ...(cursor === null ? {} : { cursor }) });
      pages.push(...page.items.map((segment) => segment.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(pages).toEqual(all.items.map((segment) => segment.id));
    const move = all.items[1];
    expect(move).toMatchObject({
      mode: "train",
      modeInferred: "train",
      modeUser: null,
      needsReview: false,
    });
    expect(move?.averageSpeed).toBeGreaterThan(20);
    const stop = all.items[0];
    expect(stop).toMatchObject({ mode: null, confidence: null, averageSpeed: null });
    // A stop says how far apart its points lie (the platform: a few metres); a move does not.
    expect(stop?.spreadM).toBeGreaterThanOrEqual(0);
    expect(stop?.spreadM).toBeLessThan(60);
    expect(move?.spreadM).toBeNull();
  });

  it("refuses a cursor it did not make", async () => {
    const response = await owner
      .get(apiPaths.v1.segments.root)
      .query({ ...day, cursor: "bm9wZQ" })
      .expect(400);
    expect(errorOf(response.body)).toMatchObject({
      code: "validation_failed",
      fields: { cursor: expect.any(Array) },
    });
  });

  it("keeps a token to its devices and scopes", async () => {
    const limited = await issue(["locations:read"], [drive]);
    const page = timelineResponseSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.v1.segments.root)
          .query(day)
          .set("Authorization", limited)
          .expect(200)
      ).body,
    );
    expect(page.items.map((segment) => segment.deviceId)).toEqual([drive]);
    await request(t.app)
      .get(apiPaths.v1.segments.root)
      .query(day)
      .set("Authorization", await issue(["devices:read"]))
      .expect(403);
    // A stop's spread is no position, yet it comes from them: history:read alone gets nothing.
    await request(t.app)
      .get(apiPaths.v1.segments.root)
      .query(day)
      .set("Authorization", await issue(["history:read"]))
      .expect(403);
  });
});

describe("PUT and DELETE /api/v1/segments/{id}/mode", () => {
  it("sets a move's mode, keeps it through processing again, and resets it", async () => {
    const move = await trainMove();
    const events = await SseClient.connect(t.app, ownerCookie);
    try {
      const set = segmentResponseSchema.parse(
        (
          await owner
            .put(apiPaths.v1.segments.mode(move.id))
            .set("Origin", testOrigin)
            .send({ mode: "metro" })
            .expect(200)
        ).body,
      );
      expect(set.segment).toMatchObject({
        id: move.id,
        mode: "metro",
        modeUser: "metro",
        modeInferred: "train",
      });
      expect((await events.waitFor("segments")).deviceId).toBe(train);
    } finally {
      events.close();
    }
    // The same again changes nothing; the override is stored once.
    await owner
      .put(apiPaths.v1.segments.mode(move.id))
      .set("Origin", testOrigin)
      .send({ mode: "metro" })
      .expect(200);
    const stored = await t.ctx.db.execute<{ source: string }>(sql`
      SELECT source FROM mode_overrides WHERE device_id = ${train} AND revoked_at IS NULL
    `);
    expect(stored.rows).toEqual([{ source: "ui" }]);

    // Processing the history again keeps the person's choice.
    await t.ctx.db.execute(sql`
      INSERT INTO processing_queue (device_id, from_at, to_at, reason) VALUES (${train}, ${day.from}, ${day.to}, 'reprocess')
    `);
    await t.ctx.processing.flush();
    const again = await trainMove();
    expect(again).toMatchObject({ id: move.id, mode: "metro", modeUser: "metro" });

    const reset = segmentResponseSchema.parse(
      (await owner.delete(apiPaths.v1.segments.mode(move.id)).set("Origin", testOrigin).expect(200))
        .body,
    );
    expect(reset.segment).toMatchObject({ mode: "train", modeUser: null });
    await t.ctx.processing.flush();
    expect(await trainMove()).toMatchObject({ mode: "train", modeUser: null });
    // Resetting again is harmless.
    await owner.delete(apiPaths.v1.segments.mode(move.id)).set("Origin", testOrigin).expect(200);
  });

  it("refuses a stop, an unknown mode, foreign ids and missing scopes", async () => {
    const { items } = await timeline(owner, { devices: train });
    const stop = items.find((segment) => segment.kind === "stop");
    const move = items.find((segment) => segment.kind === "move");
    if (stop === undefined || move === undefined) throw new Error("no stop or move");
    const conflict = await owner
      .put(apiPaths.v1.segments.mode(stop.id))
      .set("Origin", testOrigin)
      .send({ mode: "car" })
      .expect(409);
    expect(errorOf(conflict.body).code).toBe("conflict");
    await owner
      .put(apiPaths.v1.segments.mode(move.id))
      .set("Origin", testOrigin)
      .send({ mode: "unknown" })
      .expect(400);
    for (const id of [move.id, "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3", "not-a-uuid"]) {
      const response = await stranger
        .put(apiPaths.v1.segments.mode(id))
        .set("Origin", testOrigin)
        .send({ mode: "car" });
      expect(response.status).toBe(404);
    }
    const readOnly = await issue(["locations:read"]);
    const refused = await request(t.app)
      .put(apiPaths.v1.segments.mode(move.id))
      .set("Authorization", readOnly)
      .send({ mode: "car" })
      .expect(403);
    expect(errorOf(refused.body).message).toContain("locations:write");
    // The answer is the segment, positions included: writing alone is not enough.
    const writeOnly = await request(t.app)
      .put(apiPaths.v1.segments.mode(move.id))
      .set("Authorization", await issue(["locations:write"]))
      .send({ mode: "car" })
      .expect(403);
    expect(errorOf(writeOnly.body).message).toContain("locations:read");
    const otherDevice = await issue(["locations:read", "locations:write"], [drive]);
    await request(t.app)
      .delete(apiPaths.v1.segments.mode(move.id))
      .set("Authorization", otherDevice)
      .expect(404);
    // A token with the scope may; its corrections are marked as coming from the API.
    const writer = await issue(["locations:read", "locations:write"]);
    await request(t.app)
      .put(apiPaths.v1.segments.mode(move.id))
      .set("Authorization", writer)
      .send({ mode: "car" })
      .expect(200);
    const sources = await t.ctx.db.execute<{ source: string }>(sql`
      SELECT source FROM mode_overrides WHERE device_id = ${train} AND revoked_at IS NULL
    `);
    expect(sources.rows).toEqual([{ source: "api" }]);
    await request(t.app)
      .delete(apiPaths.v1.segments.mode(move.id))
      .set("Authorization", writer)
      .expect(200);
  });
});

describe("GET and POST /api/v1/devices/{id}/mode", () => {
  it("toggles the mode from now on, idempotently, and ends it", async () => {
    const path = apiPaths.v1.devices.mode(drive);
    const before = deviceModeResponseSchema.parse((await owner.get(path).expect(200)).body);
    expect(before.mode.override).toBeNull();
    const on = deviceModeResponseSchema.parse(
      (await owner.post(path).set("Origin", testOrigin).send({ mode: "train" }).expect(200)).body,
    );
    expect(on.mode.override).toMatchObject({
      kind: "toggle",
      mode: "train",
      until: null,
      source: "ui",
    });
    expect(on.mode.current).toMatchObject({ mode: "train", setByUser: true });
    const twice = deviceModeResponseSchema.parse(
      (await owner.post(path).set("Origin", testOrigin).send({ mode: "train" }).expect(200)).body,
    );
    expect(twice.mode.override?.id).toBe(on.mode.override?.id);
    const switched = deviceModeResponseSchema.parse(
      (await owner.post(path).set("Origin", testOrigin).send({ mode: "bus" }).expect(200)).body,
    );
    expect(switched.mode.override?.mode).toBe("bus");
    expect(switched.mode.override?.id).not.toBe(on.mode.override?.id);
    const off = deviceModeResponseSchema.parse(
      (await owner.post(path).set("Origin", testOrigin).send({ mode: null }).expect(200)).body,
    );
    expect(off.mode.override).toBeNull();
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const timed = deviceModeResponseSchema.parse(
      (await owner.post(path).set("Origin", testOrigin).send({ mode: "car", until }).expect(200))
        .body,
    );
    expect(timed.mode.override?.until).toBe(until);
    await owner.post(path).set("Origin", testOrigin).send({ mode: null }).expect(200);
  });

  it("refuses an until in the past, foreign devices and missing scopes", async () => {
    const path = apiPaths.v1.devices.mode(drive);
    const past = await owner
      .post(path)
      .set("Origin", testOrigin)
      .send({ mode: "car", until: new Date(Date.now() - 1000).toISOString() })
      .expect(400);
    expect(errorOf(past.body).fields).toHaveProperty("until");
    await stranger.get(path).expect(404);
    await stranger.post(path).set("Origin", testOrigin).send({ mode: "car" }).expect(404);
    await request(t.app)
      .get(path)
      .set("Authorization", await issue(["devices:read"]))
      .expect(403);
    await request(t.app)
      .post(path)
      .set("Authorization", await issue(["locations:read"]))
      .send({ mode: "car" })
      .expect(403);
    // The answer is the current mode, which tells where the device is going.
    await request(t.app)
      .post(path)
      .set("Authorization", await issue(["locations:write"]))
      .send({ mode: "car" })
      .expect(403);
    const agent = await issue(["locations:read", "locations:write"]);
    const mcp = await request(t.app)
      .post(path)
      .set("Authorization", agent)
      .send({ mode: "car" })
      .expect(200);
    expect(deviceModeResponseSchema.parse(mcp.body).mode.override?.source).toBe("api");
    await request(t.app).post(path).set("Authorization", agent).send({ mode: null }).expect(200);
  });
});

describe("GET /api/v1/stats/modes", () => {
  it("adds up distance and time per local day and mode", async () => {
    const date = "2026-10-26";
    const response = await owner
      .get(apiPaths.v1.statsModes)
      .query({ from: date, to: date })
      .expect(200);
    const stats = modeStatsResponseSchema.parse(response.body);
    expect(stats.timezone).toBe("Europe/Brussels");
    const trainDay = stats.days.find((row) => row.deviceId === train && row.mode === "train");
    expect(trainDay?.distanceM).toBeGreaterThan(29_000);
    expect(trainDay?.segments).toBe(1);
    const stationary = stats.days.find(
      (row) => row.deviceId === train && row.mode === "stationary",
    );
    expect(stationary?.segments).toBe(2);
    expect(stats.days.some((row) => row.deviceId === foreign)).toBe(false);
  });

  it("needs history:read", async () => {
    const query = { from: "2026-10-26", to: "2026-10-26" };
    await request(t.app)
      .get(apiPaths.v1.statsModes)
      .query(query)
      .set("Authorization", await issue(["locations:read"]))
      .expect(403);
    await request(t.app)
      .get(apiPaths.v1.statsModes)
      .query(query)
      .set("Authorization", await issue(["history:read"]))
      .expect(200);
    await owner
      .get(apiPaths.v1.statsModes)
      .query({ from: "2026-10-26", to: "2025-01-01" })
      .expect(400);
  });
});
