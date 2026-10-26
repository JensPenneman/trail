import { apiPaths } from "@trail/contracts/apiPaths";
import { levelTracksResponseSchema } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueBackfill } from "../../src/processing/backfill";
import { takeNextWindow } from "../../src/processing/processingQueue";
import { processingVersion } from "../../src/processing/processingVersion";
import { processWindow } from "../../src/processing/processWindow";
import { planWindow } from "../../src/processing/runPipeline";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive, sparseTrain, tramRide } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { SseClient } from "../support/sseClient";
import { distanceToLine, railLine, toXY } from "../support/syntheticWorld";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * The processing pipeline in the real app: uploads queue windows, the worker
 * (flushed by the tests) works them out with map data from the fixture way
 * source, and the levels come back through /api/v1/tracks.
 */
let t: TestContext;
const fixture = new FixtureWaySource();
let owner: Agent;
let cookie = "";

const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();
const day = { from: iso(morning - 6 * 3600), to: iso(morning + 12 * 3600) };

async function newDevice(name: string) {
  const device = await createDevice(owner, { name });
  return { id: device.device.id, token: device.credentials.accessToken };
}

/** Uploads a journey and waits for the queueing that runs after the response. */
async function upload(token: string, points: Parameters<typeof uploadJourney>[2], context = t) {
  await uploadJourney(context.app, token, points);
  await context.ctx.background.drain(5000);
}

const segmentsOf = async (deviceId: string, context = t) =>
  (
    await context.ctx.db.execute<{
      kind: string;
      mode_inferred: string | null;
      point_count: number;
    }>(sql`
      SELECT kind, mode_inferred, point_count FROM segments WHERE device_id = ${deviceId} ORDER BY started_at
    `)
  ).rows;

const tracksAt = async (deviceId: string, level: string, range = day) =>
  levelTracksResponseSchema.parse(
    (
      await owner
        .get(apiPaths.v1.tracks)
        .query({ devices: deviceId, from: range.from, to: range.to, level })
        .expect(200)
    ).body,
  );

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: fixture });
  ({ agent: owner, cookie } = await signUpWithCookie(t.app, "first@example.com"));
});

afterAll(async () => {
  await t.close();
});

describe("ingest → queue → segments", () => {
  let train = { id: "", token: "" };

  beforeAll(async () => {
    train = await newDevice("Commuter");
  });

  it("queues an upload's window, processes it with map data and announces it", async () => {
    const events = await SseClient.connect(t.app, cookie);
    try {
      await upload(train.token, sparseTrain());
      const queued = await t.ctx.db.execute<{ reason: string }>(sql`
        SELECT reason FROM processing_queue WHERE device_id = ${train.id}
      `);
      expect(queued.rows.map((row) => row.reason)).toEqual(["ingest"]);

      await t.ctx.processing.flush();
      expect(await segmentsOf(train.id)).toMatchObject([
        { kind: "stop", mode_inferred: null },
        { kind: "move", mode_inferred: "train" },
        { kind: "stop", mode_inferred: null },
      ]);
      const left = await t.ctx.db.execute(
        sql`SELECT 1 FROM processing_queue WHERE device_id = ${train.id}`,
      );
      expect(left.rows).toHaveLength(0);
      expect(fixture.requested.length).toBeGreaterThan(0);
      const event = await events.waitFor("segments");
      expect(event).toMatchObject({ deviceId: train.id });
      expect(Date.parse(event.from)).toBeLessThanOrEqual(morning * 1000);
    } finally {
      events.close();
    }
  });

  it("serves every level, the mapped one along the rails", async () => {
    const raw = await tracksAt(train.id, "raw");
    expect(raw.availableLevel).toBe("raw");
    expect(raw.segments.every((segment) => segment.kind === "track")).toBe(true);

    const averaged = await tracksAt(train.id, "averaged");
    expect(averaged.availableLevel).toBe("averaged");

    const mapped = await tracksAt(train.id, "mapped");
    expect(mapped.availableLevel).toBe("mapped");
    const line = mapped.segments.flatMap((segment) => segment.points);
    expect(line.length).toBeGreaterThan(
      5 * raw.segments.flatMap((segment) => segment.points).length,
    );
    const onRails = line.filter(([lon, lat]) => distanceToLine(toXY({ lat, lon }), railLine) < 2);
    // The platform waits are off the rails; the ride is on them.
    expect(onRails.length / line.length).toBeGreaterThan(0.85);

    const inferred = await tracksAt(train.id, "inferred");
    expect(inferred.availableLevel).toBe("inferred");
    expect(inferred.segments.map((segment) => [segment.kind, segment.mode])).toEqual([
      ["stop", null],
      ["move", "train"],
      ["stop", null],
    ]);
    // Neighbours share their boundary point: the drawn line has no gap.
    const [stop, move] = inferred.segments;
    expect(stop?.points.at(-1)?.[2]).toBe(move?.points[0]?.[2]);
  });

  it("degrades the mapped level to averaged without map data, and says so", async () => {
    const plain = await createTestContext({ waySource: null });
    try {
      const device = await newDevice("Driver");
      await upload(device.token, motorwayDrive(morning + 3600), plain);
      await plain.ctx.processing.flush();
      const mapped = await tracksAt(device.id, "mapped");
      expect(mapped.level).toBe("mapped");
      expect(mapped.availableLevel).toBe("averaged");
      const inferred = await tracksAt(device.id, "inferred");
      expect(inferred.availableLevel).toBe("averaged");
      expect(inferred.segments.map((segment) => segment.mode)).toEqual(["car"]);
    } finally {
      await plain.close();
    }
  });

  it("serves points not processed yet raw", async () => {
    const device = await newDevice("Fresh");
    await upload(device.token, motorwayDrive(morning + 7200));
    const inferred = await tracksAt(device.id, "inferred");
    expect(inferred.availableLevel).toBe("raw");
    expect(inferred.segments.map((segment) => [segment.kind, segment.level])).toEqual([
      ["track", "raw"],
    ]);
    await t.ctx.processing.flush();
    expect((await tracksAt(device.id, "inferred")).availableLevel).toBe("inferred");
  });
});

describe("map data that is missing", () => {
  it("leaves the window waiting for its tiles, then maps it once they arrive", async () => {
    const tram = await newDevice("Tram rider");
    const points = tramRide(morning + 10_800);
    // Every tile the ride needs fails for now.
    for (const tile of planWindow(points, [], t.ctx.processing.config).tiles)
      fixture.failing.add(tile);
    await upload(tram.token, points);
    await t.ctx.processing.flush();
    const waiting = await t.ctx.db.execute<{ missing: number }>(sql`
      SELECT jsonb_array_length(missing_tiles) AS missing FROM processing_queue
      WHERE device_id = ${tram.id} AND missing_tiles IS NOT NULL
    `);
    const range = { from: iso(morning + 10_000), to: iso(morning + 13_000) };
    expect(waiting.rows).toHaveLength(1);
    expect(waiting.rows[0]?.missing).toBeGreaterThan(0);
    const unmapped = await tracksAt(tram.id, "mapped", range);
    expect(unmapped.availableLevel).toBe("averaged");
    // Inference did not wait: the ride already has its segments, without map evidence.
    expect((await segmentsOf(tram.id)).length).toBeGreaterThan(0);
    fixture.failing.clear();
    await t.ctx.db.execute(
      sql`UPDATE osm_tiles SET retry_at = now() - interval '1 minute' WHERE status = 'failed'`,
    );
    await t.ctx.processing.flush();
    expect((await tracksAt(tram.id, "mapped", range)).availableLevel).toBe("mapped");
    const [move] = (await segmentsOf(tram.id)).filter((segment) => segment.kind === "move");
    expect(move?.mode_inferred).toBe("tram");
  });
});

describe("deleting a range", () => {
  it("removes the segments it touched at once and works the rest out again", async () => {
    const device = await newDevice("Deleter");
    const points = motorwayDrive(morning + 20_000);
    await upload(device.token, points);
    await t.ctx.processing.flush();
    expect(await segmentsOf(device.id)).toHaveLength(1);
    const middle = points[Math.floor(points.length / 2)]?.t ?? 0;
    await owner
      .post(apiPaths.deleteLocations)
      .set("Origin", testOrigin)
      .send({ deviceId: device.id, from: iso(middle - 60), to: iso(middle + 60) })
      .expect(200);
    // Nothing stale in between: the drive is gone until the worker has run.
    expect(await segmentsOf(device.id)).toHaveLength(0);
    const processed = await t.ctx.db.execute(sql`
      SELECT 1 FROM processed_points
      WHERE device_id = ${device.id}
        AND recorded_at >= ${iso(middle - 60)}::timestamptz AND recorded_at < ${iso(middle + 60)}::timestamptz
    `);
    expect(processed.rows).toHaveLength(0);
    await t.ctx.processing.flush();
    const after = await segmentsOf(device.id);
    expect(after.length).toBeGreaterThan(0);
    const total = after.reduce((sum, segment) => sum + segment.point_count, 0);
    expect(total).toBeLessThan(points.length);
  });
});

describe("the backfill", () => {
  it("queues every day once per version, newest first, and resumes after a restart", async () => {
    const device = await newDevice("Historian");
    for (const days of [3, 2, 1]) {
      await upload(device.token, motorwayDrive(morning - days * 86_400));
    }
    await t.ctx.dailyStats.flush();
    await t.ctx.processing.flush();
    // As if an older version had processed the history.
    await t.ctx.db.execute(sql`DELETE FROM processing_state`);
    await t.ctx.db.execute(sql`DELETE FROM segments WHERE device_id = ${device.id}`);

    const queued = await enqueueBackfill(t.ctx.db, processingVersion);
    expect(queued).toBeGreaterThanOrEqual(3);
    expect(await enqueueBackfill(t.ctx.db, processingVersion)).toBe(0);
    const [first] = await takeNextWindow(t.ctx.db, new Date());
    expect(first?.priority).toBe(1);
    const newest = await t.ctx.db.execute<{ newest: string }>(sql`
      SELECT max(from_at)::text AS newest FROM processing_queue WHERE priority = 1
    `);
    expect(first?.from.toISOString()).toBe(new Date(newest.rows[0]?.newest ?? "").toISOString());

    // One window, then a restart: the rest is still queued and gets done.
    const rows = await takeNextWindow(t.ctx.db, new Date());
    await processWindow(t.ctx.db, rows, {
      config: t.ctx.processing.config,
      mapping: true,
      now: new Date(),
    });
    const restarted = await createTestContext({ waySource: fixture });
    try {
      const remaining = await restarted.ctx.db.execute(
        sql`SELECT 1 FROM processing_queue WHERE priority = 1`,
      );
      expect(remaining.rows.length).toBeGreaterThan(0);
      await restarted.ctx.processing.flush();
      const done = await restarted.ctx.db.execute(sql`SELECT 1 FROM processing_queue`);
      expect(done.rows).toHaveLength(0);
      expect(
        (await segmentsOf(device.id, restarted)).map((segment) => segment.mode_inferred),
      ).toEqual(["car", "car", "car"]);
    } finally {
      await restarted.close();
    }
  });
});
