import { apiPaths } from "@trail/contracts/apiPaths";
import { levelTracksResponseSchema } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueBackfill } from "../../src/processing/backfill";
import { persistWindow } from "../../src/processing/persistWindow";
import {
  enqueueWindow,
  type FromLevel,
  rearmWindows,
  takeDeviceWindows,
  takeNextWindow,
} from "../../src/processing/processingQueue";
import { processingVersions } from "../../src/processing/processingVersion";
import { processWindow } from "../../src/processing/processWindow";
import { planWindow, type WindowResult } from "../../src/processing/runPipeline";
import { parseTileKey } from "../../src/processing/tileCover";
import { extendWindow, loadVisits } from "../../src/processing/windowData";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { commuteDays, rides } from "../support/commuteDays";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive, sparseTrain, tramRide } from "../support/journeys";
import { uploadJourney, uploadVisits } from "../support/overlandPoints";
import { withPieceBudget } from "../support/processWorld";
import { resetDatabase } from "../support/resetDatabase";
import { SseClient } from "../support/sseClient";
import {
  concat,
  distanceToLine,
  lastT,
  motorwayLine,
  pointAlong,
  railLine,
  stay,
  toXY,
  travel,
} from "../support/syntheticWorld";
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

/** Uploads iOS's visit reports, as the phone does. */
async function sendVisits(token: string, visits: Parameters<typeof uploadVisits>[2]) {
  await uploadVisits(t.app, token, visits);
  await t.ctx.background.drain(5000);
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

describe("stops that end when the phone leaves", () => {
  /** A device's segments as times, oldest first. */
  const timesOf = async (deviceId: string) =>
    (
      await t.ctx.db.execute<{ kind: string; mode: string | null; from: number; to: number }>(sql`
        SELECT kind, mode, extract(epoch FROM started_at)::float8 AS from,
          extract(epoch FROM ended_at)::float8 AS to
        FROM segments WHERE device_id = ${deviceId} ORDER BY started_at
      `)
    ).rows;

  /** Recorded points (kept by averaging) that lie in no segment. */
  const pointsOutside = async (deviceId: string) =>
    (
      await t.ctx.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM processed_points p
        WHERE p.device_id = ${deviceId} AND p.kept
          AND NOT EXISTS (
            SELECT 1 FROM segments s WHERE s.device_id = p.device_id
              AND s.started_at <= p.recorded_at AND s.ended_at >= p.recorded_at
          )
      `)
    ).rows[0]?.count;

  /** Works a range out again the way `trail reprocess` does: day windows, oldest first. */
  async function reprocessOldestFirst(
    deviceId: string,
    from: number,
    to: number,
    level: FromLevel,
  ) {
    for (let start = from; start < to; start += 86_400) {
      await enqueueWindow(t.ctx.db, {
        deviceId,
        from: new Date(start * 1000),
        to: new Date(Math.min(start + 86_400, to) * 1000),
        reason: "reprocess",
        fromLevel: level,
      });
    }
    for (;;) {
      const rows = await takeDeviceWindows(
        t.ctx.db,
        deviceId,
        new Date(from * 1000),
        new Date(to * 1000),
      );
      if (rows.length === 0) break;
      await processWindow(t.ctx.db, rows, {
        config: t.ctx.processing.config,
        mapping: true,
        now: new Date(),
      });
    }
  }

  it("merges iOS's two reports of a visit before leaving out the ones that departed earlier", async () => {
    const device = await newDevice("Visitor");
    const arrivedAt = morning - 12 * 3600;
    const departedAt = morning - 2 * 3600;
    const [lon, lat] = [3.7, 51.0];
    await sendVisits(device.token, [
      { arrivedAt, departedAt: null, lat, lon, accuracy: 14 },
      { arrivedAt, departedAt, lat, lon, accuracy: 9 },
      // Later the phone reports the same visit's departure once more, a little later.
      { arrivedAt, departedAt: departedAt + 40, lat, lon, accuracy: 8 },
    ]);
    // The window after the departure: the visit is over, its arrival alone no open visit.
    const after = await loadVisits(
      t.ctx.db,
      device.id,
      new Date((departedAt + 600) * 1000),
      new Date((departedAt + 7200) * 1000),
    );
    expect(after).toEqual([]);
    // A window over the stay: one visit, as the latest report has it.
    const over = await loadVisits(
      t.ctx.db,
      device.id,
      new Date((arrivedAt - 600) * 1000),
      new Date((arrivedAt + 3600) * 1000),
    );
    expect(over).toEqual([
      { arrivedAt, departedAt: departedAt + 40, endsBy: null, lat, lon, accuracy: 8 },
    ]);
  });

  it("ends a visit whose departure never came at the next visit, and forgets it after", async () => {
    const device = await newDevice("Forgetful visitor");
    const first = morning - 30 * 86_400;
    const [lon, lat] = [3.7, 51.0];
    await sendVisits(device.token, [
      { arrivedAt: first, departedAt: null, lat, lon, accuracy: 20 },
      { arrivedAt: first + 7200, departedAt: null, lat: lat + 0.01, lon, accuracy: 20 },
    ]);
    const window = (from: number, to: number) =>
      loadVisits(t.ctx.db, device.id, new Date(from * 1000), new Date(to * 1000));
    // Before the next arrival the first is open, over by then at the latest.
    expect(await window(first + 600, first + 3600)).toEqual([
      { arrivedAt: first, departedAt: null, endsBy: first + 7200, lat, lon, accuracy: 20 },
    ]);
    // A day later only the last one can still be open; the first is no longer read at all.
    const later = await window(first + 86_400, first + 90_000);
    expect(later.map((visit) => visit.arrivedAt)).toEqual([first + 7200]);
    expect(later[0]?.endsBy).toBeNull();
  });

  it("covers a night the phone recorded nothing at home, uploaded the next morning", async () => {
    // 20:00 to 23:00 at home, then the phone sleeps until 06:00 and leaves at a quarter past.
    const device = await newDevice("Night sleeper");
    const evening = Date.UTC(2026, 8, 10, 18) / 1000;
    const home: [number, number] = [-600, -400];
    const night = stay(home, { startT: evening, durationS: 3 * 3600, intervalS: 30 });
    const dawn = evening + 10 * 3600;
    const leaving = concat(
      stay(home, { startT: dawn, durationS: 900, intervalS: 10 }),
      travel([home, [-600, 600]], {
        startT: dawn + 905,
        speedMs: 1.4,
        intervalS: 2,
        motion: ["walking"],
      }),
    );
    await upload(device.token, night);
    await t.ctx.processing.flush();
    // The morning's points come in an upload of their own, its window hours after the evening's.
    await upload(device.token, leaving);
    await t.ctx.processing.flush();
    const covered = async () => {
      const segments = await timesOf(device.id);
      expect(segments.map((segment) => segment.kind)).toEqual(["stop", "move"]);
      // One stop from the evening through the night, until the walk; no hole between them.
      expect(segments[0]?.from).toBe(evening);
      expect(segments[0]?.to).toBe(segments[1]?.from);
      expect(segments[1]?.from).toBeGreaterThanOrEqual(dawn + 895);
    };
    await covered();

    // The backfill works it out a local day at a time: the night spans midnight.
    await t.ctx.dailyStats.flush();
    await t.ctx.db.execute(sql`DELETE FROM segments WHERE device_id = ${device.id}`);
    await t.ctx.db.execute(sql`
      INSERT INTO processing_state (key, value)
      VALUES ('backfill', ${JSON.stringify({ versions: { ...processingVersions, inferred: processingVersions.inferred - 1 } })}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `);
    expect((await enqueueBackfill(t.ctx.db, processingVersions)).fromLevel).toBe("inferred");
    await t.ctx.processing.flush();
    await covered();
  });

  it("keeps the part of a long stay beyond a window that cannot take all of it", async () => {
    // Four days on the sofa, a point every six minutes (one upload, so one window): one stop.
    const device = await newDevice("Sofa");
    const start = morning - 20 * 86_400;
    const days = stay([-600, -400], { startT: start, durationS: 4 * 86_400, intervalS: 360 });
    await upload(device.token, days);
    await t.ctx.processing.flush();
    expect((await timesOf(device.id)).map((segment) => segment.kind)).toEqual(["stop"]);
    // A window early in the stay grows at most two days out: the rest of the stop lies beyond it.
    await enqueueWindow(t.ctx.db, {
      deviceId: device.id,
      from: new Date((start + 6 * 3600) * 1000),
      to: new Date((start + 12 * 3600) * 1000),
      reason: "reprocess",
    });
    await t.ctx.processing.flush();
    const after = await timesOf(device.id);
    expect(after.map((segment) => segment.kind)).toEqual(["stop", "stop"]);
    // Nothing of the four days lost, nothing twice.
    expect(after[0]?.from).toBe(start);
    expect(after[1]?.to).toBe(lastT(days));
    expect(after[1]?.from).toBeGreaterThanOrEqual(after[0]?.to ?? 0);
    expect((after[1]?.from ?? 0) - (after[0]?.to ?? 0)).toBeLessThan(360);
    expect(await pointsOutside(device.id)).toBe(0);
  });

  it("replaces a stale multi-day stop, newest day first and oldest first: every ride a move", {
    timeout: 120_000,
  }, async () => {
    const device = await newDevice("Commuter days");
    const start = morning - 40 * 86_400;
    const days = commuteDays({ startT: start, days: 4, homeIntervalS: 30, homeDepartures: true });
    await upload(device.token, days.points);
    await sendVisits(device.token, days.visits);
    await t.ctx.dailyStats.flush();
    await t.ctx.processing.flush();
    const end = lastT(days.points);

    /** As the inference of version 2 left the history: one stop over all four days. */
    const makeStale = async () => {
      await t.ctx.db.execute(sql`DELETE FROM segments WHERE device_id = ${device.id}`);
      // A stop's points: where averaging put them, no way, no shape (stops are not matched).
      await t.ctx.db.execute(sql`
        UPDATE processed_points SET lat_map = lat_avg, lon_map = lon_avg, way_id = NULL,
          way_kind = NULL, snap_m = 0, path_map = NULL
        WHERE device_id = ${device.id} AND kept
      `);
      await t.ctx.db.execute(sql`
        INSERT INTO segments (device_id, started_at, ended_at, kind, distance_m, duration_s,
          point_count, start_lat, start_lon, end_lat, end_lon, centroid_lat, centroid_lon, features, version)
        SELECT ${device.id}::uuid, min(recorded_at), max(recorded_at), 'stop', 0,
          extract(epoch FROM max(recorded_at) - min(recorded_at))::integer, count(*),
          51.0, 3.7, 51.0, 3.7, 51.0, 3.7, '{}'::jsonb, ${processingVersions.inferred - 1}
        FROM processed_points WHERE device_id = ${device.id} AND kept
      `);
      expect(await timesOf(device.id)).toHaveLength(1);
    };
    const expectEveryRideAMove = async () => {
      const segments = await timesOf(device.id);
      for (const leg of rides(days.legs)) {
        let moving = 0;
        for (const segment of segments) {
          if (segment.kind !== "move") continue;
          moving += Math.max(
            0,
            Math.min(leg.endT, segment.to) - Math.max(leg.startT, segment.from),
          );
        }
        expect(moving / (leg.endT - leg.startT), `${leg.kind} from ${leg.startT}`).toBeGreaterThan(
          0.9,
        );
      }
      const longest = Math.max(...segments.map((segment) => segment.to - segment.from));
      expect(longest).toBeLessThan(14 * 3600);
      expect(await pointsOutside(device.id)).toBe(0);
      // The rides were matched afresh: their points were a stop's, with no way to reuse.
      const unmatched = await t.ctx.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM processed_points p
        JOIN segments s ON s.device_id = p.device_id AND s.kind = 'move'
          AND p.recorded_at > s.started_at AND p.recorded_at < s.ended_at
        WHERE p.device_id = ${device.id} AND p.kept AND p.way_kind IS NULL
      `);
      expect(unmatched.rows[0]?.count).toBe(0);
      expect(new Set(segments.filter((s) => s.kind === "move").map((s) => s.mode))).toEqual(
        new Set(["cycling", "walking", "train"]),
      );
    };

    // The boot-time backfill: newest day first, from the inferred level.
    await makeStale();
    await t.ctx.db.execute(sql`
      INSERT INTO processing_state (key, value)
      VALUES ('backfill', ${JSON.stringify({ versions: { ...processingVersions, inferred: processingVersions.inferred - 1 } })}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `);
    expect((await enqueueBackfill(t.ctx.db, processingVersions)).fromLevel).toBe("inferred");
    await t.ctx.processing.flush();
    await expectEveryRideAMove();

    // `trail reprocess --from-level inferred`: day windows, oldest first.
    await makeStale();
    await reprocessOldestFirst(device.id, start, end + 1, "inferred");
    await expectEveryRideAMove();
  });
});

describe("the edges of a window", () => {
  /** A device's segments with their versions, counts and the kept points of their own. */
  const partsOf = async (deviceId: string) =>
    (
      await t.ctx.db.execute<{
        kind: string;
        version: number;
        point_count: number;
        own: number;
        from: number;
        to: number;
      }>(sql`
        SELECT s.kind, s.version, s.point_count, extract(epoch FROM s.started_at)::float8 AS from,
          extract(epoch FROM s.ended_at)::float8 AS to,
          (SELECT count(*)::int FROM processed_points p
            WHERE p.device_id = s.device_id AND p.kept AND p.recorded_at >= s.started_at
              AND p.recorded_at <= least(s.ended_at,
                to_timestamp(coalesce((s.features->>'lastPointT')::float8,
                  extract(epoch FROM s.ended_at))))) AS own
        FROM segments s WHERE s.device_id = ${deviceId} ORDER BY s.started_at
      `)
    ).rows;

  const keptOutside = async (deviceId: string) =>
    (
      await t.ctx.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM processed_points p
        WHERE p.device_id = ${deviceId} AND p.kept
          AND NOT EXISTS (
            SELECT 1 FROM segments s WHERE s.device_id = p.device_id
              AND s.started_at <= p.recorded_at AND s.ended_at >= p.recorded_at
          )
      `)
    ).rows[0]?.count;

  it("cuts a stay it cannot take into parts that count their own, and works an old part out again", {
    timeout: 120_000,
  }, async () => {
    const device = await newDevice("Sofa of an older version");
    const start = morning - 30 * 86_400;
    const days = stay([-600, -400], { startT: start, durationS: 5 * 86_400, intervalS: 360 });
    await upload(device.token, days);
    await t.ctx.processing.flush();
    // As an older inference left it: one stop over the five days, counting more than it holds.
    await t.ctx.db.execute(sql`
      UPDATE segments SET version = ${processingVersions.inferred - 1}, point_count = 99999
      WHERE device_id = ${device.id}
    `);
    // `trail reprocess --to` early in it: the window grows two days out, and no further.
    const early = {
      from: new Date((start + 6 * 3600) * 1000),
      to: new Date((start + 12 * 3600) * 1000),
    };
    await enqueueWindow(t.ctx.db, {
      deviceId: device.id,
      ...early,
      reason: "reprocess",
      fromLevel: "inferred",
    });
    const taken = await takeDeviceWindows(t.ctx.db, device.id, early.from, early.to);
    await processWindow(t.ctx.db, taken, {
      config: t.ctx.processing.config,
      mapping: true,
      now: new Date(),
    });
    const parts = await partsOf(device.id);
    expect(parts.map((part) => part.version)).toEqual([
      processingVersions.inferred,
      processingVersions.inferred - 1,
    ]);
    // The part beyond the window counts its own points, not the whole stay's …
    for (const part of parts) expect(part.point_count).toBe(part.own);
    // … and, of the older version, waits to be worked out again.
    const queued = await t.ctx.db.execute<{ from_level: string }>(sql`
      SELECT from_level FROM processing_queue
      WHERE device_id = ${device.id} AND from_at = to_timestamp(${parts[1]?.from ?? 0})
    `);
    expect(queued.rows).toEqual([{ from_level: "inferred" }]);
    await t.ctx.processing.flush();
    const after = await partsOf(device.id);
    expect(new Set(after.map((part) => part.version))).toEqual(
      new Set([processingVersions.inferred]),
    );
    for (const part of after) expect(part.point_count).toBe(part.own);
    expect(after[0]?.from).toBe(start);
    expect(after.at(-1)?.to).toBe(lastT(days));
    expect(await keptOutside(device.id)).toBe(0);
  });

  it("works all of a long stop a deletion touched out again, not only around it", {
    timeout: 120_000,
  }, async () => {
    const device = await newDevice("Sofa with an hour deleted");
    const start = morning - 50 * 86_400;
    const days = stay([-600, -400], { startT: start, durationS: 4 * 86_400, intervalS: 360 });
    await upload(device.token, days);
    await t.ctx.processing.flush();
    expect((await partsOf(device.id)).map((part) => part.kind)).toEqual(["stop"]);
    const middle = start + 2 * 86_400;
    await owner
      .post(apiPaths.deleteLocations)
      .set("Origin", testOrigin)
      .send({ deviceId: device.id, from: iso(middle), to: iso(middle + 3600) })
      .expect(200);
    expect(await partsOf(device.id)).toEqual([]);
    await t.ctx.processing.flush();
    // The four days are covered again from their first point to their last.
    const after = await partsOf(device.id);
    expect(after[0]?.from).toBe(start);
    expect(after.at(-1)?.to).toBe(lastT(days));
    expect(await keptOutside(device.id)).toBe(0);
  });

  it("reaches back over a recording gap of more than half an hour, and only over one", async () => {
    const reachedFor = async (name: string, gapS: number) => {
      const device = await newDevice(name);
      const start = morning - 60 * 86_400;
      const home = stay([-600, -400], { startT: start, durationS: 3600, intervalS: 30 });
      await upload(device.token, home);
      await t.ctx.processing.flush();
      const resumed = lastT(home) + gapS;
      await upload(
        device.token,
        stay([-600, -400], { startT: resumed, durationS: 600, intervalS: 30 }),
      );
      const window = { from: new Date(resumed * 1000), to: new Date((resumed + 600) * 1000) };
      const grown = await extendWindow(t.ctx.db, device.id, window, 1800);
      return { start, resumed, from: grown.from.getTime() / 1000 };
    };
    // Ten minutes without a point: no gap to work out with both its ends.
    const pause = await reachedFor("Paused", 600);
    expect(pause.from).toBe(pause.resumed);
    // Two hours: the window takes in the stop before them.
    const night = await reachedFor("Slept", 7200);
    expect(night.from).toBe(night.start);
  });

  it("ends a toggle at the ride home after a short stop, the ride in a window of its own", {
    timeout: 120_000,
  }, async () => {
    // Twenty minutes by car — set as the train — five at the station, then forty by bike.
    const device = await newDevice("Ride home");
    const start = morning - 80 * 86_400;
    const drive = motorwayDrive(start);
    const station = pointAlong(motorwayLine, 36_500);
    const wait = stay(station, { startT: lastT(drive) + 1, durationS: 300, intervalS: 5, seed: 4 });
    const ride = travel([station, [station[0], station[1] + 12_000]], {
      startT: lastT(wait) + 1,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 8,
    });
    await t.ctx.db.execute(sql`
      INSERT INTO mode_overrides (device_id, kind, from_at, mode, source)
      VALUES (${device.id}, 'toggle', to_timestamp(${start + 30}), 'train', 'ui')
    `);
    // The first upload ends half an hour into the ride; the next one's window starts at the ride.
    const rideStart = lastT(wait);
    const cut = rideStart + 31 * 60;
    await upload(
      device.token,
      concat(
        drive,
        wait,
        ride.filter((point) => point.t < cut),
      ),
    );
    await t.ctx.processing.flush();
    await upload(
      device.token,
      ride.filter((point) => point.t >= cut),
    );
    await t.ctx.processing.flush();
    const moves = (
      await t.ctx.db.execute<{ from: number; mode_user: string | null; mode_inferred: string }>(sql`
        SELECT extract(epoch FROM started_at)::float8 AS from, mode_user, mode_inferred
        FROM segments WHERE device_id = ${device.id} AND kind = 'move' ORDER BY started_at
      `)
    ).rows;
    const drove = moves.filter((move) => move.from < rideStart);
    const rode = moves.filter((move) => move.from >= rideStart);
    expect(drove.at(-1)?.mode_user).toBe("train");
    // The ride is no part of the toggle's first move: the stop came between, in an earlier window.
    expect(rode.length).toBeGreaterThan(0);
    expect(rode.map((move) => move.mode_user)).toEqual(rode.map(() => null));
    expect(rode.map((move) => move.mode_inferred)).toContain("cycling");
    // The second window began at the ride: the station's stop is still the first window's.
    const passes = (
      await t.ctx.db.execute<{ kind: string; computed: number }>(sql`
        SELECT kind, extract(epoch FROM computed_at)::float8 AS computed FROM segments
        WHERE device_id = ${device.id} AND started_at >= to_timestamp(${lastT(drive) - 60})
        ORDER BY started_at
      `)
    ).rows;
    const [waited, ...riding] = passes;
    expect(waited?.kind).toBe("stop");
    for (const part of riding) expect(part.computed).toBeGreaterThan(waited?.computed ?? 0);
  });

  it("keeps the levels of the point a window shares with a segment that began before it", async () => {
    const device = await newDevice("Seam");
    const start = morning - 70 * 86_400;
    const points = stay([0, -2000], { startT: start, durationS: 600, intervalS: 60 });
    await upload(device.token, points);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    const seam = points[5];
    if (seam === undefined) throw new Error("no seam");
    // As the window before left them: a move up to the seam, its points matched to a road.
    const leftBefore = async (version: number) => {
      await t.ctx.db.execute(sql`DELETE FROM segments WHERE device_id = ${device.id}`);
      await t.ctx.db.execute(sql`
        INSERT INTO processed_points (device_id, recorded_at, kept, lat_avg, lon_avg, speed_avg,
          lat_map, lon_map, way_id, way_kind, snap_m, path_map, version, processed_at)
        SELECT device_id, recorded_at, true, lat, lon, 10, lat, lon, 1, 'road', 0, NULL, ${version}, now()
        FROM locations WHERE device_id = ${device.id}
        ON CONFLICT (device_id, recorded_at) DO UPDATE SET way_kind = 'road', version = ${version}
      `);
      await t.ctx.db.execute(sql`
        INSERT INTO segments (device_id, started_at, ended_at, kind, distance_m, duration_s,
          point_count, start_lat, start_lon, end_lat, end_lon, centroid_lat, centroid_lon, features, version)
        VALUES (${device.id}, to_timestamp(${start}), to_timestamp(${seam.t}), 'move', 300,
          ${seam.t - start}, 6, 51, 3.7, 51, 3.7, 51, 3.7, '{}'::jsonb, ${processingVersions.inferred})
      `);
    };
    // A window from the seam on, where the inference finds a stop: its points are not matched.
    const raw = points.slice(5);
    const last = raw.at(-1) ?? seam;
    const place = { lat: seam.lat, lon: seam.lon };
    const result: WindowResult = {
      averaged: raw.map((point) => ({
        t: point.t,
        kept: true,
        lat: point.lat,
        lon: point.lon,
        speed: 0,
        stationary: true,
        accuracy: 10,
      })),
      mapped: raw.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        wayId: null,
        wayKind: null,
        snapM: 0,
        path: null,
      })),
      segments: [
        {
          kind: "stop",
          startT: seam.t,
          endT: last.t,
          first: 0,
          last: raw.length - 1,
          distanceM: 0,
          pointCount: raw.length,
          start: place,
          end: place,
          centroid: place,
          modeInferred: null,
          modeUser: null,
          confidence: null,
          averageSpeedMs: null,
          maxSpeedMs: null,
          features: { spreadM: 0, lastPointT: last.t },
        },
      ],
      missingTiles: [],
    };
    const persist = () =>
      t.ctx.db.transaction((tx) =>
        persistWindow(tx, {
          deviceId: device.id,
          from: new Date(seam.t * 1000),
          to: new Date(last.t * 1000),
          raw,
          result,
          versions: processingVersions,
          config: t.ctx.processing.config,
        }),
      );
    const wayKinds = async () =>
      (
        await t.ctx.db.execute<{ way_kind: string | null }>(sql`
          SELECT way_kind FROM processed_points WHERE device_id = ${device.id} ORDER BY recorded_at
        `)
      ).rows.map((row) => row.way_kind);
    // The move was worked out with the seam: it keeps its road, the stop's other points are the stop's.
    await leftBefore(processingVersions.mapped);
    await persist();
    expect(await wayKinds()).toEqual([...Array(6).fill("road"), ...Array(5).fill(null)]);
    // Stored by another version of the mapped level, the seam is the window's like any point.
    await leftBefore(processingVersions.mapped - 1);
    await persist();
    expect(await wayKinds()).toEqual([...Array(5).fill("road"), ...Array(6).fill(null)]);
  });
});
