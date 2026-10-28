import { apiPaths } from "@trail/contracts/apiPaths";
import type { CacheStamp } from "@trail/contracts/cacheStamp";
import { daysResponseSchema } from "@trail/contracts/stats";
import { dayStatsResponseSchema } from "@trail/contracts/statsPublic";
import { timelineResponseSchema } from "@trail/contracts/transport";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive } from "../support/journeys";
import { overlandFixture } from "../support/overlandFixture";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { from } from "../support/sharingFlows";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * The stamps of the daily digest (docs/architecture.md §8.9): what moves the
 * raw one and the processed one, and what moves neither.
 */
let t: TestContext;
let owner: Agent;
let deviceToken = "";
let deviceId = "";

const fixtureDate = "2026-09-29";
const drivingDate = "2026-10-26";
const drivingDay = { from: "2026-10-25T23:00:00.000Z", to: "2026-10-26T23:00:00.000Z" };

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: new FixtureWaySource() });
  ({ agent: owner } = await signUpWithCookie(t.app, "first@example.com"));
  const device = await createDevice(owner, { name: "iPhone" });
  deviceToken = device.credentials.accessToken;
  deviceId = device.device.id;
  await postOverland(t.app, deviceToken, overlandFixture()).expect(200);
  await uploadJourney(t.app, deviceToken, motorwayDrive(morning));
  await settle();
  await t.ctx.processing.flush();
});

afterAll(async () => {
  await t.close();
});

async function settle(): Promise<void> {
  await t.ctx.background.drain(5_000);
  await t.ctx.dailyStats.flush();
}

/** The digest's stamp of a day (the dashboard's route). */
async function stampOf(date: string): Promise<CacheStamp | undefined> {
  const digest = daysResponseSchema.parse(
    (await owner.get(apiPaths.statsDays).query({ from: date, to: date }).expect(200)).body,
  );
  return digest.days.find((day) => day.deviceId === deviceId)?.stamp;
}

const point = (iso: string) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [3.7101, 51.0352] },
  properties: { timestamp: iso, horizontal_accuracy: 6, device_id: "test-phone" },
});

describe("the digest's stamps", () => {
  it("are on every day of both digests, the same", async () => {
    const dashboard = daysResponseSchema.parse(
      (
        await owner
          .get(apiPaths.statsDays)
          .query({ from: "2026-09-01", to: "2026-10-31" })
          .expect(200)
      ).body,
    );
    const v1 = dayStatsResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.stats.days)
          .query({ from: "2026-09-01", to: "2026-10-31" })
          .expect(200)
      ).body,
    );
    expect(dashboard.days.map((day) => day.date)).toEqual([fixtureDate, drivingDate]);
    expect(dashboard.days.every((day) => day.stamp !== undefined)).toBe(true);
    expect(v1.days.map((day) => day.stamp)).toEqual(dashboard.days.map((day) => day.stamp));
    // The drive was worked out; the fixture's few points were too.
    expect(dashboard.days.find((day) => day.date === drivingDate)?.stamp?.processed).toMatch(
      /^[A-Za-z0-9_-]{22}$/,
    );
  });

  it("keep both stamps through a re-sent upload of duplicates", async () => {
    const before = await stampOf(fixtureDate);
    await postOverland(t.app, deviceToken, overlandFixture()).expect(200);
    await settle();
    expect(await stampOf(fixtureDate)).toEqual(before);
  });

  it("move the raw stamp with a point of the day, and not another day's", async () => {
    const before = await stampOf(fixtureDate);
    const driving = await stampOf(drivingDate);
    await postOverland(t.app, deviceToken, {
      locations: [point("2026-09-29T10:00:00Z")],
    }).expect(200);
    await settle();
    const after = await stampOf(fixtureDate);
    expect(after?.raw).not.toBe(before?.raw);
    expect((await stampOf(drivingDate))?.raw).toBe(driving?.raw);
  });

  it("move the raw stamp with a visit or a trip of the day, without any point", async () => {
    const before = await stampOf(fixtureDate);
    await postOverland(t.app, deviceToken, {
      locations: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [3.71, 51.03] },
          properties: {
            action: "visit",
            timestamp: "2026-09-29T13:00:30Z",
            arrival_date: "2026-09-29T12:00:00Z",
            departure_date: "2026-09-29T13:00:00Z",
            horizontal_accuracy: 20,
          },
        },
      ],
    }).expect(200);
    const visited = await stampOf(fixtureDate);
    expect(visited?.raw).not.toBe(before?.raw);
    await postOverland(t.app, deviceToken, {
      locations: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [3.72, 51.04] },
          properties: {
            type: "trip",
            mode: "walk",
            start: "2026-09-29T14:00:00Z",
            end: "2026-09-29T14:30:00Z",
            timestamp: "2026-09-29T14:30:00Z",
          },
        },
      ],
    }).expect(200);
    expect((await stampOf(fixtureDate))?.raw).not.toBe(visited?.raw);
  });

  it("move the raw stamp when part of the day is deleted", async () => {
    const before = await stampOf(fixtureDate);
    await from(owner, "post", apiPaths.deleteLocations, {
      deviceId,
      from: "2026-09-29T06:50:00.000Z",
      to: "2026-09-29T07:00:00.000Z",
    }).expect(200);
    await settle();
    expect((await stampOf(fixtureDate))?.raw).not.toBe(before?.raw);
  });

  it("move the processed stamp while a window waits, and again once it is worked out", async () => {
    await t.ctx.processing.flush();
    const before = await stampOf(drivingDate);
    // Another drive the same day queues a window: the day waits.
    await uploadJourney(t.app, deviceToken, motorwayDrive(morning + 3_600));
    await settle();
    const waiting = await stampOf(drivingDate);
    expect(waiting?.processed).not.toBe(before?.processed);
    await t.ctx.processing.flush();
    const done = await stampOf(drivingDate);
    expect(done?.processed).not.toBe(waiting?.processed);
    expect(done?.processed).not.toBe(before?.processed);
    // The window's points were in the raw stamp already.
    expect(done?.raw).toBe(waiting?.raw);
  });

  it("move the processed stamp, and only it, with a corrected mode", async () => {
    const before = await stampOf(drivingDate);
    const timeline = timelineResponseSchema.parse(
      (await owner.get(apiPaths.v1.segments.root).query(drivingDay).expect(200)).body,
    );
    const move = timeline.items.find((item) => item.kind === "move");
    expect(move).toBeDefined();
    await owner
      .put(apiPaths.v1.segments.mode(move?.id ?? ""))
      .set("Origin", testOrigin)
      .send({ mode: "train" })
      .expect(200);
    const corrected = await stampOf(drivingDate);
    expect(corrected?.processed).not.toBe(before?.processed);
    expect(corrected?.raw).toBe(before?.raw);
    // Back to what Trail worked out: another change.
    await owner
      .delete(apiPaths.v1.segments.mode(move?.id ?? ""))
      .set("Origin", testOrigin)
      .expect(200);
    expect((await stampOf(drivingDate))?.processed).not.toBe(corrected?.processed);
  });

  it("follow the time zone: other days, other stamps", async () => {
    const before = await stampOf(drivingDate);
    await from(owner, "patch", apiPaths.me.root, { timezone: "Pacific/Auckland" }).expect(200);
    await t.ctx.background.drain(10_000);
    const digest = daysResponseSchema.parse(
      (
        await owner
          .get(apiPaths.statsDays)
          .query({ from: "2026-10-25", to: "2026-10-28" })
          .expect(200)
      ).body,
    );
    expect(digest.timezone).toBe("Pacific/Auckland");
    // 08:00 UTC on the 26th is 21:00 in Auckland: still the 26th, but another day's span.
    const auckland = digest.days.find((day) => day.date === drivingDate);
    expect(auckland?.stamp?.raw).toBeDefined();
    expect(auckland?.stamp?.raw).not.toBe(before?.raw);
    await from(owner, "patch", apiPaths.me.root, { timezone: "Europe/Brussels" }).expect(200);
    await t.ctx.background.drain(10_000);
  });
});
