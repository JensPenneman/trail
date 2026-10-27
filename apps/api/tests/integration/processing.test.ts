import { apiPaths } from "@trail/contracts/apiPaths";
import { levelTracksResponseSchema } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueBackfill } from "../../src/processing/backfill";
import {
  enqueueWindow,
  type FromLevel,
  rearmWindows,
  takeDeviceWindows,
  takeNextWindow,
} from "../../src/processing/processingQueue";
import { processingVersions } from "../../src/processing/processingVersion";
import { processWindow } from "../../src/processing/processWindow";
import { planWindow } from "../../src/processing/runPipeline";
import { parseTileKey } from "../../src/processing/tileCover";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive, sparseTrain, tramRide } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { withPieceBudget } from "../support/processWorld";
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

/** Queued windows whose ready time has more than milliseconds (the worker's clock has no more). */
const subMillisecondReadyTimes = async () =>
  (
    await t.ctx.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM processing_queue
      WHERE extract(microseconds FROM next_at)::bigint % 1000 <> 0
    `)
  ).rows[0]?.count;

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

    const queued = await enqueueBackfill(t.ctx.db, processingVersions);
    expect(queued.fromLevel).toBe("averaged");
    expect(queued.days).toBeGreaterThanOrEqual(3);
    expect(await subMillisecondReadyTimes()).toBe(0);
    expect(await enqueueBackfill(t.ctx.db, processingVersions)).toEqual({
      days: 0,
      fromLevel: null,
    });
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

  it("re-runs only the inference, on the stored mapped points, for a history of version 1", async () => {
    const device = await newDevice("Second look");
    await upload(device.token, sparseTrain(morning - 6 * 86_400));
    await upload(device.token, motorwayDrive(morning - 5 * 86_400));
    await t.ctx.dailyStats.flush();
    await t.ctx.processing.flush();
    // What version 1 left behind: one version for every level, and segments without way kinds.
    await t.ctx.db.execute(sql`
      INSERT INTO processing_state (key, value) VALUES ('backfill', '{"version": 1}'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `);
    await t.ctx.db.execute(sql`
      UPDATE segments SET version = 1, features = features - 'wayKinds' WHERE device_id = ${device.id}
    `);
    // A mark map matching would not make again: the drive's points on a trunk road instead of
    // the motorway (the same family, so the same mode).
    await t.ctx.db.execute(sql`
      UPDATE processed_points SET way_kind = 'trunk' WHERE device_id = ${device.id} AND way_kind = 'motorway'
    `);
    const storedPoints = async () =>
      (
        await t.ctx.db.execute(sql`
          SELECT recorded_at, kept, lat_map, lon_map, way_id, way_kind, snap_m, path_map, version
          FROM processed_points WHERE device_id = ${device.id} ORDER BY recorded_at
        `)
      ).rows;
    const points = await storedPoints();
    expect(points.filter((point) => point["way_kind"] === "trunk").length).toBeGreaterThan(100);
    const modes = await segmentsOf(device.id);
    const asked = fixture.requested.length;

    const queued = await enqueueBackfill(t.ctx.db, processingVersions);
    expect(queued.fromLevel).toBe("inferred");
    expect(queued.days).toBeGreaterThanOrEqual(2);
    const levels = await t.ctx.db.execute(sql`
      SELECT DISTINCT from_level FROM processing_queue WHERE reason = 'backfill'
    `);
    expect(levels.rows).toEqual([{ from_level: "inferred" }]);
    const state = await t.ctx.db.execute(
      sql`SELECT value FROM processing_state WHERE key = 'backfill'`,
    );
    expect(state.rows).toEqual([{ value: { versions: processingVersions } }]);
    expect(await enqueueBackfill(t.ctx.db, processingVersions)).toEqual({
      days: 0,
      fromLevel: null,
    });

    await t.ctx.processing.flush();
    const left = await t.ctx.db.execute(sql`SELECT 1 FROM processing_queue`);
    expect(left.rows).toHaveLength(0);
    // No map data fetched, and the mapped level as it was stored: not matched again.
    expect(fixture.requested.length).toBe(asked);
    const after = await storedPoints();
    expect(after).toEqual(points);
    expect(after.every((point) => point["version"] === processingVersions.mapped)).toBe(true);
    expect(await segmentsOf(device.id)).toEqual(modes);
    const segments = await t.ctx.db.execute<{
      kind: string;
      version: number;
      way_kinds: Record<string, number> | null;
    }>(sql`
      SELECT kind, version, features->'wayKinds' AS way_kinds
      FROM segments WHERE device_id = ${device.id} ORDER BY started_at
    `);
    expect(segments.rows.map((segment) => segment.version)).toEqual(
      modes.map(() => processingVersions.inferred),
    );
    const [train, drive] = segments.rows.filter((segment) => segment.kind === "move");
    expect(train?.way_kinds?.["rail"]).toBeGreaterThan(0.95);
    expect(drive?.way_kinds).toMatchObject({ trunk: 1, motorway: 0 });
  });

  it("keeps the more thorough level of a day already queued", async () => {
    const device = await newDevice("Queued before");
    await upload(device.token, motorwayDrive(morning - 8 * 86_400));
    await t.ctx.dailyStats.flush();
    await t.ctx.processing.flush();
    /** Queues the device's day the way the backfill does, from `level`. */
    const queueTheDay = (level: FromLevel) =>
      t.ctx.db.execute(sql`
        INSERT INTO processing_queue (device_id, from_at, to_at, reason, from_level, priority, next_at)
        SELECT s.device_id, (s.date::timestamp AT TIME ZONE u.timezone),
          ((s.date + 1)::timestamp AT TIME ZONE u.timezone), 'reprocess', ${level}, 0, now()
        FROM daily_stats s
        JOIN devices d ON d.id = s.device_id
        JOIN users u ON u.id = d.user_id
        WHERE s.device_id = ${device.id}
      `);
    const recordVersions = (versions: Record<FromLevel, number>) =>
      t.ctx.db.execute(sql`
        INSERT INTO processing_state (key, value) VALUES ('backfill', ${JSON.stringify({ versions })}::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `);
    const queuedLevels = async () =>
      (
        await t.ctx.db.execute<{ from_level: string }>(sql`
          SELECT from_level FROM processing_queue WHERE device_id = ${device.id}
        `)
      ).rows.map((row) => row.from_level);

    // A day waiting to be worked out from averaging on stays so when only the inference changed …
    await queueTheDay("averaged");
    await recordVersions({ ...processingVersions, inferred: processingVersions.inferred - 1 });
    expect((await enqueueBackfill(t.ctx.db, processingVersions)).fromLevel).toBe("inferred");
    expect(await queuedLevels()).toEqual(["averaged"]);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue`);
    // … and one waiting for the inference alone is matched again when the map matching changed.
    await queueTheDay("inferred");
    await recordVersions({ ...processingVersions, mapped: processingVersions.mapped - 1 });
    expect((await enqueueBackfill(t.ctx.db, processingVersions)).fromLevel).toBe("mapped");
    expect(await queuedLevels()).toEqual(["mapped"]);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue`);
  });
});

describe("map data a piece at a time", () => {
  it("works a window out the same from the tile cache in many pieces as in one", async () => {
    const device = await newDevice("Long rider");
    const points = sparseTrain(morning + 30_000);
    await upload(device.token, points);
    await t.ctx.processing.flush();
    const derived = async () => ({
      segments: (
        await t.ctx.db.execute<{ mode_inferred: string | null }>(sql`
          SELECT kind, mode_inferred, started_at, ended_at, round(distance_m) AS distance, confidence
          FROM segments WHERE device_id = ${device.id} ORDER BY started_at
        `)
      ).rows,
      points: (
        await t.ctx.db.execute(sql`
          SELECT recorded_at, way_id, round(lat_map::numeric, 6) AS lat, round(lon_map::numeric, 6) AS lon
          FROM processed_points WHERE device_id = ${device.id} ORDER BY recorded_at
        `)
      ).rows,
    });
    const before = await derived();
    expect(before.segments.map((segment) => segment.mode_inferred)).toEqual([null, "train", null]);

    const config = withPieceBudget(6, t.ctx.processing.config);
    expect(planWindow(points, [], config).pieces.length).toBeGreaterThan(2);
    const window = {
      from: new Date((morning + 29_000) * 1000),
      to: new Date((morning + 33_000) * 1000),
    };
    await enqueueWindow(t.ctx.db, { deviceId: device.id, ...window, reason: "reprocess" });
    const rows = await takeDeviceWindows(t.ctx.db, device.id, window.from, window.to);
    expect(rows).toHaveLength(1);
    const outcome = await processWindow(t.ctx.db, rows, { config, mapping: true, now: new Date() });
    expect(outcome?.missingTiles).toEqual([]);
    expect(await derived()).toEqual(before);
  });
});

describe("map data that is old", () => {
  it("serves an old tile, fetches it again and works the window out again", async () => {
    const device = await newDevice("Returning driver");
    const points = motorwayDrive(morning + 40_000);
    const range = { from: iso(morning + 39_000), to: iso(morning + 44_000) };
    await upload(device.token, points);
    await t.ctx.processing.flush();
    const tiles = [...planWindow(points, [], t.ctx.processing.config).tiles];
    const addresses = JSON.stringify(tiles.map((key) => parseTileKey(key)));
    const ofTheDrive = sql`(z, x, y) IN (
      SELECT * FROM jsonb_to_recordset(${addresses}::jsonb) AS r(z smallint, x integer, y integer)
    )`;
    // As if the drive's tiles had been fetched four months ago, and Overpass were down.
    await t.ctx.db.execute(
      sql`UPDATE osm_tiles SET fetched_at = now() - interval '120 days' WHERE ${ofTheDrive}`,
    );
    for (const tile of tiles) fixture.failing.add(tile);
    const asked = fixture.requested.length;
    await enqueueWindow(t.ctx.db, {
      deviceId: device.id,
      from: new Date(range.from),
      to: new Date(range.to),
      reason: "reprocess",
    });
    await t.ctx.processing.flush();
    // The old data still serves; the window waits for the fresh one.
    expect(fixture.requested.length).toBeGreaterThan(asked);
    expect((await tracksAt(device.id, "mapped", range)).availableLevel).toBe("mapped");
    const waiting = await t.ctx.db.execute<{ missing: number }>(sql`
      SELECT jsonb_array_length(missing_tiles) AS missing FROM processing_queue
      WHERE device_id = ${device.id} AND missing_tiles IS NOT NULL
    `);
    expect(waiting.rows).toEqual([{ missing: tiles.length }]);

    fixture.failing.clear();
    await t.ctx.db.execute(
      sql`UPDATE osm_tiles SET retry_at = now() - interval '1 minute' WHERE ${ofTheDrive}`,
    );
    await t.ctx.processing.flush();
    const fresh = await t.ctx.db.execute<{ old: number }>(sql`
      SELECT count(*)::int AS old FROM osm_tiles
      WHERE ${ofTheDrive} AND fetched_at < now() - interval '1 hour'
    `);
    expect(fresh.rows).toEqual([{ old: 0 }]);
    const queued = await t.ctx.db.execute(
      sql`SELECT 1 FROM processing_queue WHERE device_id = ${device.id}`,
    );
    expect(queued.rows).toHaveLength(0);
    expect((await segmentsOf(device.id)).map((segment) => segment.mode_inferred)).toEqual(["car"]);
  });
});

describe("the queue's clock", () => {
  it("makes a window whose tiles arrived ready by the worker's clock at once", async () => {
    const device = await newDevice("Clockwork");
    // The database keeps microseconds, the worker's clock milliseconds: twenty
    // times in a row, the window must be ready the moment it is made ready.
    for (let run = 0; run < 20; run += 1) {
      await t.ctx.db.execute(sql`
        INSERT INTO processing_queue (device_id, from_at, to_at, reason, priority, next_at, missing_tiles)
        VALUES (${device.id}, now(), now() + interval '1 hour', 'map', 0, now() + interval '1 day', '[]'::jsonb)
      `);
      expect(await rearmWindows(t.ctx.db, new Date())).toBe(1);
      expect(await subMillisecondReadyTimes()).toBe(0);
      const rows = await takeNextWindow(t.ctx.db, new Date());
      expect(rows.map((row) => row.deviceId)).toEqual([device.id]);
      await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    }
  });
});
