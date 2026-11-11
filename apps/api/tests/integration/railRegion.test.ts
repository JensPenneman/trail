import { apiPaths } from "@trail/contracts/apiPaths";
import type { Segment } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import {
  defaultProcessingConfig,
  type ProcessingConfig,
} from "../../src/processing/processingConfig";
import { enqueueWindow } from "../../src/processing/processingQueue";
import { RegionCoverageStore } from "../../src/processing/regionCoverageStore";
import { planWindow } from "../../src/processing/runPipeline";
import { parseTileKey } from "../../src/processing/tileCover";
import { saveTile } from "../../src/processing/tileStore";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { uploadJourney } from "../support/overlandPoints";
import { PassRunner } from "../support/passRunner";
import { assertQueueInvariants, assertSegmentInvariants } from "../support/processingInvariants";
import { importRailRegion, removeRailRegionBuilds } from "../support/railRegionBuild";
import { railTrip } from "../support/railTrips";
import { railWorld, trackA } from "../support/railWorld";
import { resetDatabase } from "../support/resetDatabase";
import { watchStatements } from "../support/statementCounter";
import { distanceToLine, subPath, toXY, type Vertex } from "../support/syntheticWorld";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * The rail network from a loaded region, whatever the tile cache holds (docs/architecture.md
 * §17.3, "Along the rails"): the rail world is written as a map data artefact whose polygon
 * covers its western half, imported with `trail map import`'s own function, and the Overpass
 * cache starts empty. Synthetic rides only.
 */
const base = 1_793_000_000;
const hour = 3600;
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();
const day = { from: iso(base - 3 * hour), to: iso(base + 40 * hour) };

const ride = (from: number, to: number, startT: number, seed: number): RawPoint[] =>
  railTrip(subPath(trackA, from, to), {
    startT,
    intervalS: 5,
    noiseM: 6,
    accuracy: 10,
    seed,
  });

const importBuild = (eastM: number, withRails = true) =>
  importRailRegion(t.ctx.db, { westM: -10_000, eastM }, withRails);

let t: TestContext;
/** The same database with no Overpass at all: no tile is ever fetched, only regions serve. */
let off: TestContext;
const fixture = new FixtureWaySource(railWorld());
let owner: Agent;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: fixture });
  off = await createTestContext({ waySource: null });
  ({ agent: owner } = await signUpWithCookie(t.app, "first@example.com"));
  await importBuild(50_000);
});

afterAll(async () => {
  await off.close();
  await t.close();
  removeRailRegionBuilds();
});

async function newDevice(name: string) {
  const device = await createDevice(owner, { name });
  return { id: device.device.id, token: device.credentials.accessToken };
}

async function upload(token: string, points: readonly RawPoint[]) {
  await uploadJourney(t.app, token, points);
  await t.ctx.background.drain(5000);
}

type Move = {
  mode: string | null;
  status: string | null;
  reason: string | null;
  source: string | null;
};

/** The device's moves with their verdicts, oldest first. */
async function moves(deviceId: string): Promise<Move[]> {
  const rows = await t.ctx.db.execute<Move>(sql`
    SELECT mode, features->'railPath'->>'status' AS status,
      features->'railPath'->>'reason' AS reason, features->'railPath'->>'source' AS source
    FROM segments WHERE device_id = ${deviceId} AND kind = 'move' ORDER BY started_at
  `);
  return rows.rows;
}

const counts = async (deviceId: string) =>
  (
    await t.ctx.db.execute<{ mapped: number; railed: number; waiting: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM processed_points WHERE device_id = ${deviceId} AND lat_map IS NOT NULL AND way_kind IS NOT NULL) AS mapped,
        (SELECT count(*)::int FROM processed_points WHERE device_id = ${deviceId} AND lat_rail IS NOT NULL) AS railed,
        (SELECT count(*)::int FROM processing_queue WHERE device_id = ${deviceId} AND missing_tiles IS NOT NULL) AS waiting
    `)
  ).rows[0] ?? { mapped: 0, railed: 0, waiting: 0 };

const timeline = async (deviceId: string): Promise<Segment[]> =>
  (
    await owner
      .get(apiPaths.v1.segments.root)
      .query({ ...day, devices: deviceId })
      .expect(200)
  ).body.items as Segment[];

async function reprocess(context: TestContext, deviceId: string) {
  await enqueueWindow(context.ctx.db, {
    deviceId,
    from: new Date((base - 3 * hour) * 1000),
    to: new Date((base + 40 * hour) * 1000),
    reason: "reprocess",
    fromLevel: "averaged",
  });
  await context.ctx.processing.flush();
}

describe("with Overpass off", () => {
  it("aligns a train inside the region from it, leaving the mapped level unmapped and queueing nothing", async () => {
    const device = await newDevice("Inside the region");
    await upload(device.token, ride(20_000, 40_000, base, 1));
    await off.ctx.processing.flush();
    const [train] = await moves(device.id);
    expect(train).toMatchObject({ status: "aligned", reason: "ok", source: "region" });
    expect(await counts(device.id)).toMatchObject({ mapped: 0, waiting: 0 });
    expect((await counts(device.id)).railed).toBeGreaterThan(50);
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
    await assertQueueInvariants(t.ctx.db, { deviceId: device.id });
    // Served: whatever mode the weaker evidence of an unmapped ride gave it, once it is a train
    // (inferred or by the person's word) it is drawn along the rails, region data and nothing else.
    const [move] = (await timeline(device.id)).filter((segment) => segment.kind === "move");
    if (move === undefined) throw new Error("no move");
    // A verdict that rests on region data alone is drawn only once the mode is no longer to review:
    // there is no mapped evidence beside it (a car on a road by the rails passes the judge there).
    expect(move.alignedTo).toBe(move.mode === "train" && !move.needsReview ? "rail" : null);
    await owner
      .put(apiPaths.v1.segments.mode(move.id))
      .set("Origin", testOrigin)
      .send({ mode: "train" })
      .expect(200);
    const [corrected] = (await timeline(device.id)).filter((segment) => segment.kind === "move");
    expect(corrected).toMatchObject({ mode: "train", alignedTo: "rail" });
    const tracks = await owner
      .get(apiPaths.v1.tracks)
      .query({ ...day, devices: device.id, level: "inferred", maxPoints: 50_000 })
      .expect(200);
    const line = (tracks.body.segments as { id: string; points: number[][] }[]).find(
      (segment) => segment.id === move.id,
    );
    expect(line?.points.length).toBeGreaterThan(50);
    for (const point of line?.points ?? []) {
      expect(
        distanceToLine(toXY({ lon: point[0] ?? 0, lat: point[1] ?? 0 }), trackA as Vertex[]),
      ).toBeLessThan(5);
    }
  });

  it("reads rail ways for a train and for no walk or bike: walks add no rail-only statement", async () => {
    const walker = await newDevice("Walking in the region");
    const cyclist = await newDevice("Cycling in the region");
    const rider = await newDevice("Riding in the region");
    const walk = railTrip(
      [
        [20_000, 3000],
        [21_500, 3000],
      ],
      { startT: base + 20 * hour, intervalS: 2, speedMs: 1.4, noiseM: 3, accuracy: 8, seed: 7 },
    );
    const bike = railTrip(
      [
        [22_000, 3000],
        [26_500, 3000],
      ],
      { startT: base + 22 * hour, intervalS: 2, speedMs: 5, noiseM: 3, accuracy: 8, seed: 8 },
    );
    const watch = watchStatements(off.ctx.pool);
    // The rail-only read is the one statement with the light first pass over the ways.
    const railReads = () => watch.texts.filter((text) => /newest AS/.test(text)).length;
    try {
      await upload(walker.token, walk);
      await upload(cyclist.token, bike);
      watch.reset();
      await off.ctx.processing.flush();
      expect(railReads(), "walks and bikes read no rail ways").toBe(0);
      for (const device of [walker, cyclist]) {
        for (const move of await moves(device.id)) expect(move.status).toBeNull();
        expect((await counts(device.id)).railed).toBe(0);
      }
      await upload(rider.token, ride(30_000, 40_000, base + 24 * hour, 9));
      watch.reset();
      await off.ctx.processing.flush();
      expect(railReads(), "a train reads its rail ways").toBeGreaterThan(0);
    } finally {
      watch.stop();
    }
  });

  it("takes the tiles the cache still holds as rail data outside every region, the mapped level staying unmapped", async () => {
    const device = await newDevice("Cached tiles, no region");
    const points = ride(85_000, 95_000, base + 30 * hour, 12);
    // An install that had Overpass on earlier: the tiles are in the cache, no region covers them.
    for (const tile of planWindow(points, [], off.ctx.processing.config).tiles) {
      const address = parseTileKey(tile);
      if (address === null) throw new Error(`no tile ${tile}`);
      await saveTile(t.ctx.db, address, await fixture.fetchTile(address), new Date());
    }
    await upload(device.token, points);
    await off.ctx.processing.flush();
    const [train] = await moves(device.id);
    expect(train).toMatchObject({ status: "aligned", reason: "ok", source: "cache" });
    // Not mapped: with Overpass off the mapped level is not worked out, whatever the cache holds.
    expect(await counts(device.id)).toMatchObject({ mapped: 0, waiting: 0 });
    expect((await counts(device.id)).railed).toBeGreaterThan(50);
    await assertQueueInvariants(t.ctx.db, { deviceId: device.id });
  });

  it("calls a train that leaves the region no_map/outside_regions and serves it as recorded", async () => {
    const device = await newDevice("Leaving the region");
    await upload(device.token, ride(40_000, 60_000, base + 6 * hour, 2));
    await off.ctx.processing.flush();
    const [train] = await moves(device.id);
    expect(train).toMatchObject({ status: "no_map", reason: "outside_regions", source: null });
    expect((await counts(device.id)).railed).toBe(0);
    for (const segment of await timeline(device.id)) expect(segment.alignedTo).toBeNull();
  });
});

describe("with Overpass refusing every tile", () => {
  it("aligns from the region at once while the window waits, and from the cache once it has the tiles", async () => {
    const device = await newDevice("Waiting for the cache");
    const points = ride(20_000, 40_000, base + 12 * hour, 3);
    for (const tile of planWindow(points, [], t.ctx.processing.config).tiles) {
      fixture.failing.add(tile);
    }
    try {
      await upload(device.token, points);
      await t.ctx.processing.flush();
      const [waiting] = await moves(device.id);
      expect(waiting).toMatchObject({ status: "aligned", source: "region" });
      expect(await counts(device.id)).toMatchObject({ mapped: 0 });
      expect((await counts(device.id)).waiting).toBeGreaterThan(0);
      await assertQueueInvariants(t.ctx.db, { deviceId: device.id });
    } finally {
      fixture.failing.clear();
    }
    await t.ctx.db.execute(
      sql`UPDATE osm_tiles SET retry_at = now() - interval '1 minute' WHERE status = 'failed'`,
    );
    await t.ctx.processing.flush();
    const [mapped] = await moves(device.id);
    expect(mapped).toMatchObject({ status: "aligned", source: "cache" });
    expect(await counts(device.id)).toMatchObject({ waiting: 0 });
    expect((await counts(device.id)).mapped).toBeGreaterThan(50);
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
    await assertQueueInvariants(t.ctx.db, { deviceId: device.id });
  });
});

describe("a region swapped between passes", () => {
  it("aligns from the new build, and draws nothing where the new build has no rail", async () => {
    const device = await newDevice("Across builds");
    // Overpass off again: only the region serves, so each answer is the region's.
    await upload(device.token, ride(55_000, 75_000, base + 18 * hour, 4));
    await off.ctx.processing.flush();
    expect((await moves(device.id))[0]).toMatchObject({
      status: "no_map",
      reason: "outside_regions",
    });
    await importBuild(90_000);
    await reprocess(off, device.id);
    expect((await moves(device.id))[0]).toMatchObject({ status: "aligned", source: "region" });
    // A build of the same extract without railways: the tiles are covered and hold none.
    await importBuild(90_000, false);
    await reprocess(off, device.id);
    // A part with no run along rails is no_rail, not too short for a verdict.
    const [bare] = await moves(device.id);
    expect(bare).toMatchObject({ status: "no_rail", reason: "no_rail" });
    expect((await counts(device.id)).railed).toBe(0);
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
  });
});

describe("the per-pass cap on rail-only reads, with Overpass off", () => {
  const rideA = ride(20_000, 30_000, base + 33 * hour, 21);
  const rideB = ride(35_000, 45_000, base + 36 * hour, 22);
  const tilesOf = (points: readonly RawPoint[]) =>
    planWindow(points, [], defaultProcessingConfig).tiles.size;
  // One ride's tiles fit, both do not; the two rides are pieces of their own.
  const cap = Math.max(tilesOf(rideA), tilesOf(rideB));
  const withCap = (railOnlyMaxTilesPerPass: number, pieceMaxTiles = cap): ProcessingConfig => ({
    ...defaultProcessingConfig,
    mapping: { ...defaultProcessingConfig.mapping, pieceMaxTiles },
    rail: { ...defaultProcessingConfig.rail, railOnlyMaxTilesPerPass },
  });
  const runner = (config: ProcessingConfig) =>
    new PassRunner({
      db: t.ctx.db,
      config,
      mapping: false,
      regions: new RegionCoverageStore(),
    });
  const snapshot = async (deviceId: string) => ({
    state: (await t.ctx.db.execute(sql`SELECT * FROM processing_state ORDER BY key`)).rows,
    queue: (
      await t.ctx.db.execute(
        sql`SELECT count(*)::int AS n FROM processing_queue WHERE device_id = ${deviceId}`,
      )
    ).rows,
  });

  it("defers one of two trains without queueing anything, the operator's reprocess of its day aligns it, and a later deferring pass keeps the line", async () => {
    expect(tilesOf(rideA) + tilesOf(rideB)).toBeGreaterThan(cap);
    const device = await newDevice("Two trains, a small cap");
    await upload(device.token, [...rideA, ...rideB]);
    const before = await snapshot(device.id);
    const first = await runner(withCap(cap)).drain();
    expect(first.reduce((sum, pass) => sum + pass.outcome.rail.deferredMoves, 0)).toBe(1);
    const statuses = (await moves(device.id)).map((move) => `${move.status}/${move.reason}`);
    expect(statuses.filter((status) => status === "aligned/ok")).toHaveLength(1);
    expect(statuses.filter((status) => status === "no_map/deferred")).toHaveLength(1);
    // Nothing waits for it and no processing state moved.
    expect(await snapshot(device.id)).toEqual({ ...before, queue: [{ n: 0 }] });
    await assertQueueInvariants(t.ctx.db, { deviceId: device.id });

    // The documented recovery: the deferred ride's own bounds, worked again from the inferred level.
    const [deferred] = (
      await t.ctx.db.execute<{ from: string; to: string }>(sql`
        SELECT started_at::text AS "from", ended_at::text AS "to" FROM segments
        WHERE device_id = ${device.id} AND features->'railPath'->>'reason' = 'deferred'
      `)
    ).rows;
    if (deferred === undefined) throw new Error("no deferred ride");
    await enqueueWindow(t.ctx.db, {
      deviceId: device.id,
      from: new Date(deferred.from),
      to: new Date(deferred.to),
      reason: "reprocess",
      fromLevel: "inferred",
    });
    await runner(withCap(cap)).drain();
    expect((await moves(device.id)).map((move) => `${move.status}/${move.reason}`)).toEqual([
      "aligned/ok",
      "aligned/ok",
    ]);

    // A pass that defers everything leaves the stored lines and still serves them along the rails.
    for (const segment of (await timeline(device.id)).filter((item) => item.kind === "move")) {
      await owner
        .put(apiPaths.v1.segments.mode(segment.id))
        .set("Origin", testOrigin)
        .send({ mode: "train" })
        .expect(200);
    }
    await enqueueWindow(t.ctx.db, {
      deviceId: device.id,
      from: new Date((base + 30 * hour) * 1000),
      to: new Date((base + 40 * hour) * 1000),
      reason: "reprocess",
      fromLevel: "inferred",
    });
    // The ride ranked first is always read; the other is deferred and keeps what an earlier pass stored.
    const deferring = await runner(withCap(0)).drain();
    expect(deferring.reduce((sum, pass) => sum + pass.outcome.rail.deferredMoves, 0)).toBe(1);
    expect((await moves(device.id)).map((move) => `${move.status}/${move.reason}`)).toEqual([
      "aligned/ok",
      "aligned/ok",
    ]);
    const served = (await timeline(device.id)).filter((item) => item.kind === "move");
    expect(served).toHaveLength(2);
    for (const segment of served) expect(segment.alignedTo).toBe("rail");
    expect((await counts(device.id)).railed).toBeGreaterThan(100);
  });

  it("reads a ride whose own tiles exceed the cap in its first pass, and one ride after the other when two do", async () => {
    // A cap far below one ride's tiles.
    const small = withCap(1);
    expect(tilesOf(rideA)).toBeGreaterThan(1);
    const single = await newDevice("One ride over the cap");
    await upload(single.token, rideA);
    await runner(small).drain();
    expect((await moves(single.id)).map((move) => `${move.status}/${move.reason}`)).toEqual([
      "aligned/ok",
    ]);

    const device = await newDevice("Two rides over the cap");
    await upload(device.token, [...rideA, ...rideB]);
    const before = await snapshot(device.id);
    const first = await runner(small).drain();
    expect(first.reduce((sum, pass) => sum + pass.outcome.rail.deferredMoves, 0)).toBe(1);
    expect((await moves(device.id)).map((move) => `${move.status}/${move.reason}`).sort()).toEqual([
      "aligned/ok",
      "no_map/deferred",
    ]);
    expect(await snapshot(device.id)).toEqual({ ...before, queue: [{ n: 0 }] });
    await assertQueueInvariants(t.ctx.db, { deviceId: device.id });

    // The documented reprocess of the deferred ride's own bounds reads it, whatever the cap.
    const [deferred] = (
      await t.ctx.db.execute<{ from: string; to: string }>(sql`
        SELECT started_at::text AS "from", ended_at::text AS "to" FROM segments
        WHERE device_id = ${device.id} AND features->'railPath'->>'reason' = 'deferred'
      `)
    ).rows;
    if (deferred === undefined) throw new Error("no deferred ride");
    await enqueueWindow(t.ctx.db, {
      deviceId: device.id,
      from: new Date(deferred.from),
      to: new Date(deferred.to),
      reason: "reprocess",
      fromLevel: "inferred",
    });
    await runner(small).drain();
    expect((await moves(device.id)).map((move) => `${move.status}/${move.reason}`)).toEqual([
      "aligned/ok",
      "aligned/ok",
    ]);
    expect(await snapshot(device.id)).toEqual({ ...before, queue: [{ n: 0 }] });
  });
});
