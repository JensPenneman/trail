import { apiPaths } from "@trail/contracts/apiPaths";
import type { DayStamp } from "@trail/contracts/cacheStamp";
import { daysResponseSchema } from "@trail/contracts/stats";
import { tracksResponseSchema } from "@trail/contracts/track";
import { segmentResponseSchema, timelineResponseSchema } from "@trail/contracts/transport";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent } from "../support/authFlows";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive } from "../support/journeys";
import { overlandFixture } from "../support/overlandFixture";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { from, uploadOf } from "../support/sharingFlows";
import { type StatementWatch, watchStatements } from "../support/statementCounter";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * Conditional answers (docs/architecture.md §8.9): every route of the
 * browser cache's §4.2 answers 200 with a weak ETag, 304 without a body to
 * its own ETag, 200 again once what it is made of changed, and 200 to an
 * ETag of another account. The stamps in the day-sliced answers are the
 * digest's, and they are read before the data.
 */
let t: TestContext;
let owner: Agent;
let other: Agent;
let otherEmail = "";
let deviceToken = "";
let deviceId = "";
let watch: StatementWatch;

/** 26 October 2026 in Brussels (UTC+1 since the 25th). */
const drivingDay = { from: "2026-10-25T23:00:00.000Z", to: "2026-10-26T23:00:00.000Z" };
/** The fixture's day: 29 September 2026 in Brussels (UTC+2). */
const fixtureDay = { from: "2026-09-28T22:00:00.000Z", to: "2026-09-29T22:00:00.000Z" };
const etagShape = /^W\/"[A-Za-z0-9_-]{22}"$/;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: new FixtureWaySource() });
  watch = watchStatements(t.ctx.pool);
  ({ agent: owner } = await signUpWithCookie(t.app, "first@example.com"));
  otherEmail = "other@allowed.test";
  ({ agent: other } = await signUpWithCookie(t.app, otherEmail));
  const device = await createDevice(owner, { name: "iPhone" });
  deviceToken = device.credentials.accessToken;
  deviceId = device.device.id;
  await postOverland(t.app, deviceToken, overlandFixture()).expect(200);
  await uploadJourney(t.app, deviceToken, motorwayDrive(morning));
  await settle();
});

afterAll(async () => {
  watch.stop();
  await t.close();
});

/** Statistics summed up and windows processed: what a few seconds after an upload looks like. */
async function settle(): Promise<void> {
  await t.ctx.background.drain(5_000);
  await t.ctx.dailyStats.flush();
  await t.ctx.processing.flush();
}

interface Case {
  name: string;
  path: string;
  query?: Record<string, string>;
  /** Something that changes what the answer is made of. */
  change: () => Promise<void>;
}

/** A point recorded during the drive, on its day, at `second` past the drive's start. */
const drivePoint = (second: number) => ({
  locations: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [3.75, 51.01] },
      properties: {
        timestamp: new Date((morning + second) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        horizontal_accuracy: 5,
        device_id: "test-phone",
      },
    },
  ],
});

let extraSecond = 30;
/** Uploads one more point of the drive's day and lets the statistics catch up. */
async function uploadOnDrivingDay(): Promise<void> {
  extraSecond += 1;
  await postOverland(t.app, deviceToken, drivePoint(-3600 - extraSecond)).expect(200);
  await settle();
}

/** A visit report on the fixture's day: changes the visits and the day's raw stamp, no point. */
async function visitOnFixtureDay(): Promise<void> {
  extraSecond += 1;
  const at = `2026-09-29T12:${String(extraSecond % 60).padStart(2, "0")}:00Z`;
  await postOverland(t.app, deviceToken, {
    locations: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [3.71, 51.03] },
        properties: {
          action: "visit",
          timestamp: at,
          arrival_date: "2026-09-29T11:00:00Z",
          departure_date: at,
          horizontal_accuracy: 20,
        },
      },
    ],
  }).expect(200);
}

/** A trip on the fixture's day. */
async function tripOnFixtureDay(): Promise<void> {
  extraSecond += 1;
  const start = `2026-09-29T14:${String(extraSecond % 60).padStart(2, "0")}:00Z`;
  await postOverland(t.app, deviceToken, {
    locations: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [3.72, 51.04] },
        properties: {
          type: "trip",
          mode: "walk",
          start,
          end: "2026-09-29T15:30:00Z",
          distance: 900,
          duration: 1200,
          timestamp: "2026-09-29T15:30:00Z",
        },
      },
    ],
  }).expect(200);
}

/** Corrects the first move of the drive's day (a person's mode): the processed stamp moves. */
let nextMode: "bus" | "car" = "bus";
async function correctAMove(): Promise<void> {
  const timeline = timelineResponseSchema.parse(
    (await owner.get(apiPaths.v1.segments.root).query(drivingDay).expect(200)).body,
  );
  const move = timeline.items.find((item) => item.kind === "move");
  if (move === undefined) throw new Error("The drive has no move");
  nextMode = nextMode === "bus" ? "car" : "bus";
  segmentResponseSchema.parse(
    (
      await owner
        .put(apiPaths.v1.segments.mode(move.id))
        .set("Origin", testOrigin)
        .send({ mode: nextMode })
        .expect(200)
    ).body,
  );
}

const cases: Case[] = [
  { name: "the devices", path: apiPaths.devices.root, change: uploadOnDrivingDay },
  { name: "tracks", path: apiPaths.tracks, query: drivingDay, change: uploadOnDrivingDay },
  { name: "visits", path: apiPaths.visits, query: fixtureDay, change: visitOnFixtureDay },
  { name: "trips", path: apiPaths.trips, query: fixtureDay, change: tripOnFixtureDay },
  {
    name: "the daily statistics",
    path: apiPaths.statsDays,
    query: { from: "2026-09-01", to: "2026-10-31" },
    change: uploadOnDrivingDay,
  },
  {
    name: "the heatmap",
    path: apiPaths.heatmap,
    query: { bbox: "-180,-85,180,85", zoom: "3" },
    change: uploadOnDrivingDay,
  },
  {
    name: "v1 tracks at a level",
    path: apiPaths.v1.tracks,
    query: { ...drivingDay, level: "inferred" },
    change: correctAMove,
  },
  {
    name: "v1 tracks raw",
    path: apiPaths.v1.tracks,
    query: { ...drivingDay, level: "raw" },
    change: uploadOnDrivingDay,
  },
  {
    name: "v1 stops and moves",
    path: apiPaths.v1.segments.root,
    query: drivingDay,
    change: correctAMove,
  },
  {
    name: "v1 daily statistics",
    path: apiPaths.v1.stats.days,
    query: { from: "2026-09-01", to: "2026-10-31" },
    change: uploadOnDrivingDay,
  },
  {
    name: "v1 Insights overview",
    path: apiPaths.v1.insights.overview,
    query: { from: "2026-10-01", to: "2026-10-31" },
    change: correctAMove,
  },
  {
    name: "v1 Insights of a mode",
    path: apiPaths.v1.insights.mode("car"),
    query: { from: "2026-10-01", to: "2026-10-31" },
    change: correctAMove,
  },
  {
    name: "v1 Insights by time",
    path: apiPaths.v1.insights.time,
    query: { from: "2026-10-01", to: "2026-10-31" },
    change: correctAMove,
  },
  {
    name: "v1 Insights by road",
    path: apiPaths.v1.insights.roads,
    query: { from: "2026-10-01", to: "2026-10-31" },
    change: correctAMove,
  },
  {
    name: "v1 people",
    path: apiPaths.v1.people.root,
    change: async () => {
      await from(owner, "post", apiPaths.v1.shares.root, {
        email: otherEmail,
        precision: "precise",
        duration: "indefinitely",
      }).expect(201);
    },
  },
];

const ask = (agent: Agent, test: Case, etag?: string) => {
  const pending = agent.get(test.path).query(test.query ?? {});
  return etag === undefined ? pending : pending.set("If-None-Match", etag);
};

describe("conditional answers", () => {
  for (const test of cases) {
    it(`${test.name}: 304 to its own ETag, 200 after a change and to another account`, async () => {
      // People: the other account looks at the owner, who starts to share with them.
      const looker = test.path === apiPaths.v1.people.root ? other : owner;
      const first = await ask(looker, test).expect(200);
      const etag = first.headers["etag"] ?? "";
      expect(etag).toMatch(etagShape);
      expect(first.headers["cache-control"]).toBe("no-store");

      const same = await ask(looker, test, etag).expect(304);
      expect(same.text).toBe("");
      expect(same.headers["etag"]).toBe(etag);
      expect(same.headers["cache-control"]).toBe("no-store");
      expect(same.headers["x-request-id"]).toBeDefined();
      expect(same.headers["content-encoding"]).toBeUndefined();
      // Among others, and weak or strong alike.
      await ask(looker, test, `"nope", ${etag.slice(2)}`).expect(304);

      // The owner is in the hash: another account's ETag never matches.
      const stranger = looker === owner ? other : owner;
      await ask(stranger, test, etag).expect(200);

      await test.change();
      const changed = await ask(looker, test, etag).expect(200);
      expect(changed.headers["etag"]).toMatch(etagShape);
      expect(changed.headers["etag"]).not.toBe(etag);
    });
  }

  it("the heatmap: a deletion moves its ETag, also when as many new points follow", async () => {
    const view = { bbox: "-180,-85,180,85", zoom: "3" };
    const first = await owner.get(apiPaths.heatmap).query(view).expect(200);
    // Four points of the fixture's morning go, and nothing else of it…
    const removed = await from(owner, "post", apiPaths.deleteLocations, {
      deviceId,
      from: "2026-09-29T07:00:00.000Z",
      to: "2026-09-29T07:05:00.000Z",
    }).expect(200);
    expect(removed.body).toEqual({ deleted: 4 });
    // …and four others arrive elsewhere: the devices' point counters add up as before.
    await postOverland(t.app, deviceToken, {
      locations: [1, 2, 3, 4].map((minute) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [3.9, 51.1] },
        properties: {
          timestamp: `2026-09-30T10:0${minute}:00Z`,
          horizontal_accuracy: 5,
          device_id: "test-phone",
        },
      })),
    }).expect(200);
    await owner
      .get(apiPaths.heatmap)
      .query(view)
      .set("If-None-Match", first.headers["etag"] ?? "")
      .expect(200);
  });
});

describe("stamps", () => {
  const digest = async () =>
    daysResponseSchema.parse(
      (
        await owner
          .get(apiPaths.statsDays)
          .query({ from: "2026-09-01", to: "2026-10-31" })
          .expect(200)
      ).body,
    ).days;

  const stampsOfDay = (stamps: readonly DayStamp[] | undefined, date: string) =>
    (stamps ?? []).filter((stamp) => stamp.date === date);

  it("are the digest's for the same instant, on every route", async () => {
    const days = await digest();
    const row = days.find((day) => day.date === "2026-10-26");
    const fixtureRow = days.find((day) => day.date === "2026-09-29");
    expect(row?.stamp?.processed).not.toBeNull();
    const tracks = tracksResponseSchema.parse(
      (await owner.get(apiPaths.tracks).query(drivingDay).expect(200)).body,
    );
    const level = (
      await owner
        .get(apiPaths.v1.tracks)
        .query({ ...drivingDay, level: "mapped" })
        .expect(200)
    ).body as { stamps?: DayStamp[] };
    const timeline = timelineResponseSchema.parse(
      (await owner.get(apiPaths.v1.segments.root).query(drivingDay).expect(200)).body,
    );
    const visits = (await owner.get(apiPaths.visits).query(fixtureDay).expect(200)).body as {
      stamps?: DayStamp[];
    };
    for (const stamps of [tracks.stamps, level.stamps, timeline.stamps]) {
      expect(stampsOfDay(stamps, "2026-10-26")).toEqual([
        { deviceId, date: "2026-10-26", ...row?.stamp },
      ]);
    }
    expect(stampsOfDay(visits.stamps, "2026-09-29")).toEqual([
      { deviceId, date: "2026-09-29", ...fixtureRow?.stamp },
    ]);
  });

  it("cover every device and local day of the range, days without points too", async () => {
    const week = { from: "2026-10-19T22:00:00.000Z", to: "2026-10-26T23:00:00.000Z" };
    const tracks = tracksResponseSchema.parse(
      (await owner.get(apiPaths.tracks).query(week).expect(200)).body,
    );
    expect(tracks.stamps?.map((stamp) => stamp.date)).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
    expect(tracks.stamps?.find((stamp) => stamp.date === "2026-10-21")?.processed).toBeNull();
  });

  it("are read before the data: an upload between the two is a 200 next time, never a 304", async () => {
    const before = (await digest()).find((day) => day.date === "2026-10-26")?.stamp;
    // Right after the stamps' statement, before the points are read: an upload lands.
    watch.after(/WITH days AS/, async () => {
      await postOverland(t.app, deviceToken, drivePoint(3_000)).expect(200);
      await t.ctx.dailyStats.flush();
    });
    const raced = await owner.get(apiPaths.tracks).query(drivingDay).expect(200);
    const answer = tracksResponseSchema.parse(raced.body);
    // The answer holds the new point, its stamps the day without it.
    expect(answer.tracks[0]?.points.some((point) => point[2] === morning + 3_000)).toBe(true);
    expect(stampsOfDay(answer.stamps, "2026-10-26")[0]?.raw).toBe(before?.raw);
    const after = (await digest()).find((day) => day.date === "2026-10-26")?.stamp;
    expect(after?.raw).not.toBe(before?.raw);
    // So the next look fetches it all again.
    await owner
      .get(apiPaths.tracks)
      .query(drivingDay)
      .set("If-None-Match", raced.headers["etag"] ?? "")
      .expect(200);
  });

  it("change for today at once with an upload, before the statistics catch up", async () => {
    const today = {
      from: new Date(Date.now() - 3_600_000).toISOString(),
      to: new Date().toISOString(),
    };
    await postOverland(t.app, deviceToken, uploadOf([{ ago: 120, lat: 51.02, lon: 3.73 }])).expect(
      200,
    );
    await settle();
    const first = await owner.get(apiPaths.tracks).query(today).expect(200);
    await postOverland(t.app, deviceToken, uploadOf([{ ago: 60, lat: 51.02, lon: 3.731 }])).expect(
      200,
    );
    // No flush: the daily statistics are ten seconds behind, the device's counter is not.
    await owner
      .get(apiPaths.tracks)
      .query(today)
      .set("If-None-Match", first.headers["etag"] ?? "")
      .expect(200);
  });
});

describe("the cost of a dashboard open", () => {
  /** What the People page asks for when it opens on the drive's day. */
  const open = [
    { path: apiPaths.devices.root },
    { path: apiPaths.v1.people.root },
    { path: apiPaths.tracks, query: drivingDay },
    { path: apiPaths.v1.tracks, query: { ...drivingDay, level: "inferred" } },
    { path: apiPaths.v1.segments.root, query: drivingDay },
  ];

  /** Statements per request, the access log's batched writes aside (they run later, in the background). */
  async function measure(etags: Map<string, string>): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const request of open) {
      await t.ctx.dataAccess.flush();
      watch.reset();
      const etag = etags.get(request.path + JSON.stringify(request.query ?? {}));
      const pending = owner.get(request.path).query(request.query ?? {});
      const response = await (etag === undefined ? pending : pending.set("If-None-Match", etag));
      etags.set(request.path + JSON.stringify(request.query ?? {}), response.headers["etag"] ?? "");
      counts[`${request.path} ${response.status}`] = watch.texts.filter(
        (text) => !text.includes("data_access_events"),
      ).length;
    }
    return counts;
  }

  it("is a few statements per request once nothing changed", async () => {
    await settle();
    const etags = new Map<string, string>();
    const cold = await measure(etags);
    const warm = await measure(etags);
    // Every request reads its session first. Cold, each then reads its validator (the
    // devices' rows, the stamps of the day) and the data; warm, the validator answers it:
    // no points, no day of counting, no segments.
    expect(cold).toEqual({
      "/api/devices 200": 3,
      "/api/v1/people 200": 2,
      "/api/tracks 200": 4,
      "/api/v1/tracks 200": 7,
      "/api/v1/segments 200": 6,
    });
    expect(warm).toEqual({
      "/api/devices 304": 2,
      "/api/v1/people 304": 2,
      "/api/tracks 304": 3,
      "/api/v1/tracks 304": 3,
      "/api/v1/segments 304": 3,
    });
  });
});
