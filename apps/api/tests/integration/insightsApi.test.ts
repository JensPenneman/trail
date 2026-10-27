import { apiPaths } from "@trail/contracts/apiPaths";
import { apiErrorSchema } from "@trail/contracts/errors";
import {
  insightsModeSchema,
  insightsOverviewSchema,
  insightsRoadsSchema,
  insightsTimeSchema,
} from "@trail/contracts/insights";
import { type Segment, timelineResponseSchema } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firstInsightsDay } from "../../src/insights/insightsPeriod";
import { localDate } from "../../src/lib/localDate";
import { type Agent, agentFor, signUp, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FakeApiTokens, tokenPrincipal } from "../support/fakeApiTokens";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive, sparseTrain } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * Insights (docs/architecture.md §8.7) on journeys processed with map data:
 * the four operations with the session and with tokens (scope, device
 * restrictions, other people's devices), empty and pending periods, the
 * three-year cap, and prorating across local midnight and the night summer
 * time ends, on segments written by hand.
 */
let t: TestContext;
const tokens = new FakeApiTokens();
let owner: Agent;
let stranger: Agent;
let train = "";
let drive = "";
let foreign = "";

const ownerEmail = "first@example.com";
/** The journeys' Monday, 26 October 2026, in the account's zone (Europe/Brussels). */
const monday = "2026-10-26";
const day = { from: monday, to: monday };
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: new FixtureWaySource(), apiTokens: tokens });
  ({ agent: owner } = await signUpWithCookie(t.app, ownerEmail));
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

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): Set<string> {
  const keys = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        keys.add(key);
        visit(child);
      }
    }
  };
  visit(value);
  return keys;
}

const coordinateKeys = ["lat", "lon", "start", "end", "centroid", "points", "location"];

/** The owner's moves of the Monday, as the timeline has them. */
async function mondayMoves(): Promise<Segment[]> {
  const response = await owner
    .get(apiPaths.v1.segments.root)
    .query({ from: "2026-10-25T23:00:00Z", to: "2026-10-26T23:00:00Z" })
    .expect(200);
  return timelineResponseSchema.parse(response.body).items.filter((item) => item.kind === "move");
}

describe("GET /api/v1/insights/overview", () => {
  it("adds up the owner's moves of the period, by mode, without a coordinate", async () => {
    const response = await owner.get(apiPaths.v1.insights.overview).query(day).expect(200);
    const overview = insightsOverviewSchema.parse(response.body);
    const moves = await mondayMoves();
    expect(moves.map((move) => move.mode).sort()).toEqual(["car", "train"]);
    const distance = moves.reduce((sum, move) => sum + move.distanceM, 0);
    const time = moves.reduce((sum, move) => sum + move.durationS, 0);

    expect(overview.timezone).toBe("Europe/Brussels");
    expect(overview.period).toEqual({
      from: monday,
      to: monday,
      days: 1,
      bucket: "day",
      buckets: [monday],
    });
    expect(overview.totals.distanceM).toBeCloseTo(distance, 0);
    expect(overview.totals.durationS).toBe(time);
    expect(overview.totals).toMatchObject({ moves: 2, activeDays: 1 });
    expect(overview.totals.stops).toBeGreaterThanOrEqual(2);
    expect(overview.modes.map((row) => row.mode).sort()).toEqual(["car", "train"]);
    expect(overview.modes.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 2);
    for (const row of overview.modes) {
      expect(row.deltaDistanceM).toBe(row.distanceM);
      expect(row.moves).toBe(1);
    }
    expect(overview.series.map((entry) => entry.bucket)).toEqual([monday, monday]);
    expect(overview.previous).toMatchObject({ from: "2026-10-25", to: "2026-10-25", days: 1 });
    expect(overview.previous.totals.moves).toBe(0);
    expect(overview.pending).toBe(false);
    for (const key of coordinateKeys) expect(keysOf(response.body).has(key)).toBe(false);
  });

  it("starts at the first day with data and ends today when the period is left out", async () => {
    const overview = insightsOverviewSchema.parse(
      (await owner.get(apiPaths.v1.insights.overview).expect(200)).body,
    );
    const today = localDate(new Date(), "Europe/Brussels");
    const earliest = firstInsightsDay(today);
    expect(overview.period.to).toBe(today);
    expect(overview.period.from).toBe(monday < earliest ? earliest : monday);
    if (monday >= earliest) expect(overview.totals.moves).toBe(2);
  });

  it("is empty for a period without moves, and refuses periods over three years", async () => {
    const empty = insightsOverviewSchema.parse(
      (
        await owner
          .get(apiPaths.v1.insights.overview)
          .query({ from: "2026-01-05", to: "2026-03-01" })
          .expect(200)
      ).body,
    );
    expect(empty.totals).toEqual({
      distanceM: 0,
      durationS: 0,
      moves: 0,
      stops: 0,
      activeDays: 0,
    });
    expect(empty.modes).toEqual([]);
    expect(empty.series).toEqual([]);
    expect(empty.period.bucket).toBe("week");
    expect(empty.period.buckets[0]).toBe("2026-01-05");

    const tooLong = await owner
      .get(apiPaths.v1.insights.overview)
      .query({ from: "2023-10-26", to: monday })
      .expect(400);
    expect(errorOf(tooLong.body)).toMatchObject({ code: "validation_failed" });
    expect(errorOf(tooLong.body).fields).toHaveProperty("to");
    // Three years exactly is fine.
    await owner
      .get(apiPaths.v1.insights.overview)
      .query({ from: "2023-10-27", to: monday })
      .expect(200);
    await owner
      .get(apiPaths.v1.insights.overview)
      .query({ from: monday, to: "2026-10-25" })
      .expect(400);
    // `to` left out is today: a `from` more than three years before is refused too.
    const fromOnly = await owner
      .get(apiPaths.v1.insights.overview)
      .query({ from: "2019-01-01" })
      .expect(400);
    expect(errorOf(fromOnly.body).fields).toHaveProperty("to");
  });

  it("says so while points of the period wait for processing", async () => {
    await t.ctx.db.execute(sql`
      INSERT INTO processing_queue (device_id, from_at, to_at, reason)
      VALUES (${drive}, '2026-10-26T11:00:00Z', '2026-10-26T12:00:00Z', 'ingest')
    `);
    try {
      const busy = insightsOverviewSchema.parse(
        (await owner.get(apiPaths.v1.insights.overview).query(day).expect(200)).body,
      );
      expect(busy.pending).toBe(true);
      const elsewhere = insightsOverviewSchema.parse(
        (
          await owner
            .get(apiPaths.v1.insights.overview)
            .query({ from: "2026-10-19", to: "2026-10-25" })
            .expect(200)
        ).body,
      );
      expect(elsewhere.pending).toBe(false);
    } finally {
      await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${drive}`);
    }
  });
});

describe("GET /api/v1/insights/modes/{mode}", () => {
  it("tells the train ride by its rails, hours and top moves", async () => {
    const response = await owner.get(apiPaths.v1.insights.mode("train")).query(day).expect(200);
    const insights = insightsModeSchema.parse(response.body);
    const [ride] = (await mondayMoves()).filter((move) => move.mode === "train");
    if (ride === undefined) throw new Error("no train ride");
    expect(insights.mode).toBe("train");
    expect(insights.totals).toMatchObject({ moves: 1, durationS: ride.durationS });
    expect(insights.totals.distanceM).toBeCloseTo(ride.distanceM, 0);
    expect(insights.totals.typicalSpeedKmh).toBeGreaterThan(60);
    expect(insights.totals.longest?.segmentId).toBe(ride.id);
    expect(insights.topMoves.recent.map((move) => move.segmentId)).toEqual([ride.id]);
    expect(insights.topMoves.longest[0]).toMatchObject({
      segmentId: ride.id,
      deviceId: train,
      startedAt: ride.startedAt,
      endedAt: ride.endedAt,
    });
    // A Monday morning, local time.
    expect(insights.byWeekday[0]?.durationS).toBe(ride.durationS);
    const hours = insights.byHour.filter((hour) => hour.durationS > 0).map((hour) => hour.hour);
    expect(hours.every((hour) => hour >= 8 && hour <= 9)).toBe(true);
    expect(insights.roads.mappedM).toBeGreaterThan(0);
    expect(insights.roads.kinds.find((kind) => kind.kind === "rail")?.share).toBeGreaterThan(0.9);
    expect(insights.rail?.share).toBeGreaterThan(0.9);
    expect(insights.ferry).toBeNull();
    expect(insights.stationStops).not.toBeNull();
    expect(insights.speedHistogram.bins.reduce((sum, bin) => sum + bin.moves, 0)).toBe(1);
    expect(insights.series).toHaveLength(1);
    for (const key of coordinateKeys) expect(keysOf(response.body).has(key)).toBe(false);
  });

  it("puts the drive on the motorway, and answers an unknown mode with 404", async () => {
    const car = insightsModeSchema.parse(
      (await owner.get(apiPaths.v1.insights.mode("car")).query(day).expect(200)).body,
    );
    expect(car.totals.moves).toBe(1);
    expect(car.roads.kinds.find((kind) => kind.kind === "motorway")?.share).toBeGreaterThan(0.9);
    expect(car.rail).toBeNull();
    expect(car.stationStops).toBeNull();
    const plane = insightsModeSchema.parse(
      (await owner.get(apiPaths.v1.insights.mode("plane")).query(day).expect(200)).body,
    );
    expect(plane.totals).toMatchObject({ moves: 0, distanceM: 0, longest: null });
    const unknown = await owner.get(apiPaths.v1.insights.mode("teleport")).query(day).expect(404);
    expect(errorOf(unknown.body).code).toBe("not_found");
  });
});

describe("GET /api/v1/insights/time and /roads", () => {
  it("fills the week's hours, for one mode or every one", async () => {
    const all = insightsTimeSchema.parse(
      (await owner.get(apiPaths.v1.insights.time).query(day).expect(200)).body,
    );
    const moves = await mondayMoves();
    expect(all.cells).toHaveLength(168);
    expect(all.modes).toEqual(["car", "train"]);
    expect(all.mode).toBeNull();
    const mondayCells = all.cells.filter((cell) => cell.weekday === 1);
    expect(mondayCells.reduce((sum, cell) => sum + cell.durationS, 0)).toBe(
      moves.reduce((sum, move) => sum + move.durationS, 0),
    );
    expect(
      all.cells.filter((cell) => cell.weekday !== 1).every((cell) => cell.durationS === 0),
    ).toBe(true);
    const cars = insightsTimeSchema.parse(
      (
        await owner
          .get(apiPaths.v1.insights.time)
          .query({ ...day, mode: "car" })
          .expect(200)
      ).body,
    );
    expect(cars.mode).toBe("car");
    expect(cars.modes).toEqual(["car", "train"]);
    const carMove = moves.find((move) => move.mode === "car");
    expect(cars.cells.reduce((sum, cell) => sum + cell.durationS, 0)).toBe(carMove?.durationS);
  });

  it("splits the distance by kind and family of way", async () => {
    const roads = insightsRoadsSchema.parse(
      (await owner.get(apiPaths.v1.insights.roads).query(day).expect(200)).body,
    );
    expect(roads.mappedM).toBeGreaterThan(0.9 * roads.distanceM);
    const kinds = new Map(roads.kinds.map((row) => [row.kind, row]));
    expect(kinds.get("motorway")?.distanceM).toBeGreaterThan(30_000);
    expect(kinds.get("rail")?.distanceM).toBeGreaterThan(25_000);
    const families = new Map(roads.families.map((row) => [row.family, row.share]));
    expect((families.get("motorway") ?? 0) + (families.get("rail") ?? 0)).toBeGreaterThan(0.9);
    const trainRoads = insightsRoadsSchema.parse(
      (
        await owner
          .get(apiPaths.v1.insights.roads)
          .query({ ...day, mode: "train" })
          .expect(200)
      ).body,
    );
    expect(trainRoads.kinds.some((row) => row.kind === "motorway")).toBe(false);
    await owner
      .get(apiPaths.v1.insights.roads)
      .query({ ...day, mode: "hovercraft" })
      .expect(400);
  });
});

describe("who may read Insights", () => {
  const operations = [
    apiPaths.v1.insights.overview,
    apiPaths.v1.insights.mode("train"),
    apiPaths.v1.insights.time,
    apiPaths.v1.insights.roads,
  ];

  it("needs history:read, which tokens with it have", async () => {
    const reader = await issue(["history:read"]);
    const locations = await issue(["locations:read", "devices:read"]);
    for (const path of operations) {
      await request(t.app).get(path).query(day).set("Authorization", reader).expect(200);
      const refused = await request(t.app)
        .get(path)
        .query(day)
        .set("Authorization", locations)
        .expect(403);
      expect(errorOf(refused.body).code).toBe("insufficient_scope");
      await request(t.app).get(path).query(day).expect(401);
    }
  });

  it("keeps a token to its devices, and other people's devices out", async () => {
    const carOnly = await issue(["history:read"], [drive]);
    const overview = insightsOverviewSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.v1.insights.overview)
          .query(day)
          .set("Authorization", carOnly)
          .expect(200)
      ).body,
    );
    expect(overview.modes.map((row) => row.mode)).toEqual(["car"]);
    const trainless = insightsModeSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.v1.insights.mode("train"))
          .query(day)
          .set("Authorization", carOnly)
          .expect(200)
      ).body,
    );
    expect(trainless.totals.moves).toBe(0);
    for (const path of [apiPaths.v1.insights.overview, apiPaths.v1.insights.roads]) {
      await request(t.app)
        .get(path)
        .query({ ...day, devices: train })
        .set("Authorization", carOnly)
        .expect(404);
      await owner
        .get(path)
        .query({ ...day, devices: foreign })
        .expect(404);
    }
    // The stranger's own drive is theirs alone; they never see the owner's.
    const theirs = insightsOverviewSchema.parse(
      (await stranger.get(apiPaths.v1.insights.overview).query(day).expect(200)).body,
    );
    expect(theirs.modes.map((row) => row.mode)).toEqual(["car"]);
    expect(theirs.totals.moves).toBe(1);
    const mine = insightsOverviewSchema.parse(
      (
        await owner
          .get(apiPaths.v1.insights.overview)
          .query({ ...day, devices: drive })
          .expect(200)
      ).body,
    );
    expect(mine.modes.map((row) => row.mode)).toEqual(["car"]);
  });
});

describe("prorating by the local clock", () => {
  let clock = "";

  /** A move written straight into the timeline, at exact times. */
  async function writeMove(
    started: string,
    ended: string,
    distanceM: number,
    features: Record<string, unknown> = {},
  ) {
    const duration = (Date.parse(ended) - Date.parse(started)) / 1000;
    await t.ctx.db.execute(sql`
      INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, confidence,
        distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
        centroid_lat, centroid_lon, features, version)
      VALUES (${clock}, ${started}::timestamptz, ${ended}::timestamptz, 'move', 'cycling', 'cycling',
        0.9, ${distanceM}, ${duration}, 6, 10, 51, 3.7, 51.01, 3.71, 51.005, 3.705,
        ${JSON.stringify({ speed: { median: 18 }, ...features })}::jsonb, 2)
    `);
  }

  beforeAll(async () => {
    clock = (await createDevice(owner, { name: "Clock watcher" })).device.id;
    // 23:30 on Friday 23 October to 00:30 on Saturday, summer time: 6 km.
    await writeMove("2026-10-23T21:30:00Z", "2026-10-23T22:30:00Z", 6000);
    // 01:30 summer time to 02:30 winter time on Sunday 25 October: two hours, 12 km.
    await writeMove("2026-10-24T23:30:00Z", "2026-10-25T01:30:00Z", 12_000, {
      wayKinds: { cycleway: 0.5, residential: 0.5 },
    });
  });

  it("splits a move at local midnight and the night summer time ends by its time", async () => {
    const query = { from: "2026-10-23", to: "2026-10-25", devices: clock };
    const overview = insightsOverviewSchema.parse(
      (await owner.get(apiPaths.v1.insights.overview).query(query).expect(200)).body,
    );
    expect(overview.series).toEqual([
      { bucket: "2026-10-23", mode: "cycling", distanceM: 3000, durationS: 1800 },
      { bucket: "2026-10-24", mode: "cycling", distanceM: 3000, durationS: 1800 },
      { bucket: "2026-10-25", mode: "cycling", distanceM: 12_000, durationS: 7200 },
    ]);
    expect(overview.totals).toMatchObject({ distanceM: 18_000, durationS: 10_800, moves: 2 });

    const time = insightsTimeSchema.parse(
      (await owner.get(apiPaths.v1.insights.time).query(query).expect(200)).body,
    );
    const sunday = (hour: number) => time.cells[6 * 24 + hour];
    expect(sunday(1)).toMatchObject({ durationS: 1800, distanceM: 3000 });
    // 02:00 came twice: an hour of summer time and half an hour of winter time.
    expect(sunday(2)).toMatchObject({ durationS: 5400, distanceM: 9000 });
    expect(time.cells[4 * 24 + 23]).toMatchObject({ durationS: 1800 });
    expect(time.cells[5 * 24]).toMatchObject({ durationS: 1800 });

    // Only the Saturday: the parts inside it.
    const saturday = insightsModeSchema.parse(
      (
        await owner
          .get(apiPaths.v1.insights.mode("cycling"))
          .query({ from: "2026-10-24", to: "2026-10-24", devices: clock })
          .expect(200)
      ).body,
    );
    expect(saturday.totals).toMatchObject({ distanceM: 3000, durationS: 1800, moves: 0 });
    const sundayOnly = insightsRoadsSchema.parse(
      (
        await owner
          .get(apiPaths.v1.insights.roads)
          .query({ from: "2026-10-25", to: "2026-10-25", devices: clock })
          .expect(200)
      ).body,
    );
    expect(sundayOnly).toMatchObject({ distanceM: 12_000, mappedM: 12_000 });
    expect(sundayOnly.kinds).toEqual([
      { kind: "residential", distanceM: 6000, share: 0.5 },
      { kind: "cycleway", distanceM: 6000, share: 0.5 },
    ]);
  });
});
