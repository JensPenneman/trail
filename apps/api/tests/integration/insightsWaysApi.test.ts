import { apiPaths } from "@trail/contracts/apiPaths";
import { apiErrorSchema } from "@trail/contracts/errors";
import { insightsWaysSchema } from "@trail/contracts/insights";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lockDeviceProcessing } from "../../src/processing/deviceLock";
import { runFeatureBackfill } from "../../src/processing/featureBackfill";
import { type Agent, agentFor, signUp, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FakeApiTokens, tokenPrincipal } from "../support/fakeApiTokens";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { bikeRide, motorwayDrive, sparseTrain, tramRide, walkInTown } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * Named roads (docs/architecture.md §8.7): the metres per way that processing
 * stores, and GET /api/v1/insights/ways on moves written by hand with the
 * ways they were on — grouping by name and place, the mode filter, devices,
 * scope and the ETag.
 */
let t: TestContext;
const tokens = new FakeApiTokens();
let owner: Agent;
let bike = "";
let walk = "";
let foreign = "";
let drive = "";

const ownerEmail = "first@example.com";
const week = { from: "2026-10-19", to: "2026-10-25" };
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;
const fetchedAt = "2026-10-01T00:00:00Z";

async function move(
  deviceId: string,
  mode: string,
  started: string,
  ended: string,
  distanceM: number,
  wayTotals: [number, number][] | null | undefined,
) {
  await t.ctx.db.execute(sql`
    INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, confidence,
      distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
      centroid_lat, centroid_lon, features, version)
    VALUES (${deviceId}, ${started}::timestamptz, ${ended}::timestamptz, 'move', ${mode}, ${mode},
      0.9, ${distanceM}, ${(Date.parse(ended) - Date.parse(started)) / 1000}, 6, 10, 51, 3.7,
      51.01, 3.71, 51.005, 3.705,
      ${JSON.stringify({ speed: { median: 18 }, ...(wayTotals === undefined ? {} : { wayTotals }) })}::jsonb, 3)
  `);
}

async function way(
  id: number,
  source: string,
  name: string | null,
  kind: string,
  at: { lat: number; lon: number },
  fetched = fetchedAt,
) {
  const tags = JSON.stringify(name === null ? { highway: kind } : { name, highway: kind });
  await t.ctx.db.execute(sql`
    INSERT INTO osm_ways (id, source, kind, tags, nodes, geometry, min_lat, min_lon, max_lat,
      max_lon, fetched_at)
    VALUES (${id}, ${source}, ${kind}, ${tags}::jsonb, '{1,2}'::bigint[], ''::bytea,
      ${at.lat - 0.001}, ${at.lon - 0.001}, ${at.lat + 0.001}, ${at.lon + 0.001},
      ${fetched}::timestamptz)
  `);
}

const brussels = { lat: 50.85, lon: 4.35 };
const liege = { lat: 50.63, lon: 5.57 };

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ apiTokens: tokens, waySource: new FixtureWaySource() });
  ({ agent: owner } = await signUpWithCookie(t.app, ownerEmail));
  const stranger = agentFor(t.app);
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");
  bike = (await createDevice(owner, { name: "Bike" })).device.id;
  walk = (await createDevice(owner, { name: "Walk" })).device.id;
  const car = await createDevice(owner, { name: "Car" });
  drive = car.device.id;
  foreign = (await createDevice(stranger, { name: "Stranger's phone" })).device.id;

  // 101 and 103 are one Rue de la Gare in Brussels, 102 another in Liège, 105 a ring road with an
  // older name in another build, 104 has no name.
  await way(101, "overpass", "Rue de la Gare", "residential", brussels);
  await way(103, "overpass", "Rue de la Gare", "residential", brussels);
  await way(102, "overpass", "Rue de la Gare", "residential", liege);
  await way(104, "overpass", null, "residential", brussels);
  await way(105, "overpass", "Old Ring", "motorway", brussels, "2026-09-01T00:00:00Z");
  await t.ctx.db.execute(
    sql`CREATE TABLE IF NOT EXISTS osm_ways_build PARTITION OF osm_ways FOR VALUES IN ('belgium@20261002-abcd1234')`,
  );
  await way(105, "belgium@20261002-abcd1234", "Ring", "motorway", brussels, "2026-10-02T00:00:00Z");

  await move(bike, "cycling", "2026-10-20T09:00:00Z", "2026-10-20T10:00:00Z", 10_000, [
    [101, 6000],
    [102, 2000],
    [103, 1000],
    [104, 900],
  ]);
  await move(walk, "walking", "2026-10-21T09:00:00Z", "2026-10-21T10:00:00Z", 1500, [
    [101, 1000],
    [105, 500],
  ]);
  // A move the feature backfill has not reached yet, and one of the stranger's.
  await move(bike, "cycling", "2026-10-22T09:00:00Z", "2026-10-22T10:00:00Z", 4000, undefined);
  await move(foreign, "car", "2026-10-20T09:00:00Z", "2026-10-20T10:00:00Z", 50_000, [
    [101, 50_000],
  ]);
});

afterAll(async () => {
  await t.close();
});

const ways = (query: Record<string, string> = {}, agent: Agent = owner) =>
  agent.get(apiPaths.v1.insights.ways).query({ ...week, ...query });
const parsed = async (query: Record<string, string> = {}) =>
  insightsWaysSchema.parse((await ways(query).expect(200)).body);

describe("GET /api/v1/insights/ways", () => {
  it("lists the roads by name and place, longest first, with the newest build's names", async () => {
    const answer = await parsed();
    expect(answer.mode).toBeNull();
    expect(answer.modes).toEqual(["walking", "cycling"]);
    // The moves with map data; the one waiting for its totals counts for nothing yet.
    expect(answer.mappedM).toBe(11_500);
    // 101 + 103 in Brussels (8000), 102 in Liège (2000), 105 (500); 104 has no name.
    expect(answer.namedM).toBe(10_500);
    expect(answer.ways.map((row) => [row.name, row.distanceM, row.moves])).toEqual([
      ["Rue de la Gare", 8000, 2],
      ["Rue de la Gare", 2000, 1],
      ["Ring", 500, 1],
    ]);
    expect(answer.ways[0]).toMatchObject({ kind: "residential" });
    expect(answer.ways[2]).toMatchObject({ kind: "motorway" });
    expect(answer.pending).toBe(true);
  });

  it("holds names and distances only, no position", async () => {
    const body = (await ways().expect(200)).body as { ways: object[] };
    for (const row of body.ways) {
      expect(Object.keys(row).sort()).toEqual(["distanceM", "kind", "moves", "name"]);
    }
    expect(JSON.stringify(body)).not.toMatch(/\d\.\d{3,}/);
  });

  it("takes one mode when asked, and still lists every mode moved in", async () => {
    const walking = await parsed({ mode: "walking" });
    expect(walking.mode).toBe("walking");
    expect(walking.modes).toEqual(["walking", "cycling"]);
    expect(walking.ways.map((row) => [row.name, row.distanceM, row.moves])).toEqual([
      ["Rue de la Gare", 1000, 1],
      ["Ring", 500, 1],
    ]);
    const car = await parsed({ mode: "car", devices: drive });
    expect(car).toMatchObject({ mappedM: 0, namedM: 0, ways: [], modes: [], pending: false });
  });

  it("counts a move on the days it was on, and no other", async () => {
    const day = await parsed({ from: "2026-10-20", to: "2026-10-20", devices: bike });
    expect(day).toMatchObject({ mappedM: 10_000, pending: false });
    const other = await parsed({ from: "2026-10-21", to: "2026-10-21", devices: bike });
    expect(other).toMatchObject({ mappedM: 0, ways: [] });
  });

  it("keeps to the owner's devices: a foreign one is a 404, never counted", async () => {
    await ways({ devices: foreign }).expect(404);
    expect((await parsed()).ways[0]?.distanceM).toBe(8000);
  });
});

describe("who may read it", () => {
  const issue = async (
    scopes: Parameters<typeof tokenPrincipal>[2]["scopes"],
    deviceIds: string[] | null = null,
  ) => `Bearer ${tokens.issue(await tokenPrincipal(t.ctx.db, ownerEmail, { scopes, deviceIds }))}`;

  it("needs locations:read: history:read alone is refused", async () => {
    const history = await issue(["history:read"]);
    const locations = await issue(["locations:read"]);
    const refused = await request(t.app)
      .get(apiPaths.v1.insights.ways)
      .query(week)
      .set("Authorization", history)
      .expect(403);
    expect(errorOf(refused.body).code).toBe("insufficient_scope");
    await request(t.app)
      .get(apiPaths.v1.insights.ways)
      .query(week)
      .set("Authorization", locations)
      .expect(200);
    await request(t.app).get(apiPaths.v1.insights.ways).query(week).expect(401);
  });

  it("keeps a token to its devices", async () => {
    const walkOnly = await issue(["locations:read"], [walk]);
    const answer = insightsWaysSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.v1.insights.ways)
          .query(week)
          .set("Authorization", walkOnly)
          .expect(200)
      ).body,
    );
    expect(answer.mappedM).toBe(1500);
    await request(t.app)
      .get(apiPaths.v1.insights.ways)
      .query({ ...week, devices: bike })
      .set("Authorization", walkOnly)
      .expect(404);
  });
});

describe("ETags", () => {
  const ask = (etag?: string) => {
    const pending = ways();
    return etag === undefined ? pending : pending.set("If-None-Match", etag);
  };

  it("answers 304 to its own, and a new one after a move or a map fetch", async () => {
    const etag = String((await ask().expect(200)).headers["etag"]);
    await ask(etag).expect(304);
    await move(walk, "walking", "2026-10-23T09:00:00Z", "2026-10-23T10:00:00Z", 100, [[101, 100]]);
    const afterMove = await ask(etag).expect(200);
    const second = String(afterMove.headers["etag"]);
    expect(second).not.toBe(etag);
    await ask(second).expect(304);
    await t.ctx.db.execute(sql`
      INSERT INTO osm_tiles (z, x, y, status, fetched_at, way_count, poi_count, bytes)
      VALUES (14, 1, 1, 'ok', now() + interval '1 hour', 0, 0, 1)
    `);
    expect(String((await ask(second).expect(200)).headers["etag"])).not.toBe(second);
  });
});

describe("the metres on each way that processing stores", () => {
  it("are on a processed move, whole ways of at least 25 m, longest first", async () => {
    await uploadJourney(
      t.app,
      (await createDevice(owner, { name: "Motorway" })).credentials.accessToken,
      motorwayDrive(),
    );
    await t.ctx.background.drain(5000);
    await t.ctx.processing.flush();
    const { rows } = await t.ctx.db.execute<{
      distance_m: number;
      totals: [number, number][] | null;
    }>(sql`
      SELECT s.distance_m, s.features->'wayTotals' AS totals FROM segments s
      WHERE s.kind = 'move' AND s.features ? 'wayTotals' AND s.distance_m > 5000
    `);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const totals = row.totals ?? [];
      expect(totals.length).toBeGreaterThan(0);
      expect(totals.every(([, metres]) => metres >= 25)).toBe(true);
      expect(totals.map(([, metres]) => metres)).toEqual(
        [...totals.map(([, metres]) => metres)].sort((a, b) => b - a),
      );
      expect(totals.reduce((sum, [, metres]) => sum + metres, 0)).toBeLessThanOrEqual(
        row.distance_m + 1,
      );
    }
  });
});

describe("the feature backfill", () => {
  interface Stored {
    id: string;
    totals: [number, number][] | null;
    version: number;
    computed_at: string;
  }
  const stored = async (deviceId: string): Promise<Stored[]> =>
    (
      await t.ctx.db.execute<Stored & Record<string, unknown>>(sql`
        SELECT id, features->'wayTotals' AS totals, version, computed_at::text AS computed_at
        FROM segments WHERE device_id = ${deviceId}::uuid AND kind = 'move' ORDER BY started_at
      `)
    ).rows;

  it("fills the totals of stored moves as the pipeline counts them, once, without touching their stamps", async () => {
    // Curved and sparse journeys, not a straight line: intervals follow the way's shape between
    // matched points, or the chord where a point is not matched.
    const journeys = [
      ["Town", walkInTown],
      ["Train", sparseTrain],
      ["Tram", tramRide],
      ["Bike", bikeRide],
    ] as const;
    const devices: string[] = [];
    for (const [name, journey] of journeys) {
      const made = await createDevice(owner, { name: `Backfilled ${name}` });
      await uploadJourney(t.app, made.credentials.accessToken, journey());
      devices.push(made.device.id);
    }
    await t.ctx.background.drain(5000);
    await t.ctx.processing.flush();
    const before = (await Promise.all(devices.map(stored))).flat();
    expect(before.length).toBeGreaterThanOrEqual(journeys.length);
    expect(before.flatMap((row) => row.totals ?? []).length).toBeGreaterThan(0);
    await t.ctx.db.execute(sql`
      UPDATE segments SET features = features - 'wayTotals'
      WHERE device_id = ANY(${sql.param(devices)}::uuid[])
    `);
    const answer = () =>
      ways({ devices: devices.join(","), from: "2026-10-26", to: "2026-10-26" })
        .expect(200)
        .then((response) => insightsWaysSchema.parse(response.body));
    expect((await answer()).pending).toBe(true);

    const run = await runFeatureBackfill(t.ctx.db, { pauseMs: 0 });
    expect(run).toMatchObject({ features: ["wayTotals"], complete: true });
    expect(run.moves).toBeGreaterThanOrEqual(before.length);
    const after = (await Promise.all(devices.map(stored))).flat();
    expect(after.map((row) => [row.id, row.version, row.computed_at])).toEqual(
      before.map((row) => [row.id, row.version, row.computed_at]),
    );
    // The same ways with the same metres, to the pipeline's rounding of a tenth.
    for (const [index, row] of after.entries()) {
      const expected = new Map(before[index]?.totals ?? []);
      expect([...(row.totals ?? [])].map(([id]) => id).sort((x, y) => x - y)).toEqual(
        [...expected.keys()].sort((x, y) => x - y),
      );
      for (const [id, metres] of row.totals ?? []) {
        expect(Math.abs(metres - (expected.get(id) ?? Number.NaN))).toBeLessThanOrEqual(0.15);
      }
    }
    expect((await answer()).pending).toBe(false);

    // Recorded as done: a later start finds nothing to fill, even for a move lacking the totals.
    const state = await t.ctx.db.execute<{ value: unknown }>(
      sql`SELECT value FROM processing_state WHERE key = 'features'`,
    );
    expect(state.rows[0]?.value).toEqual({ versions: { wayTotals: 1 } });
    expect(await runFeatureBackfill(t.ctx.db, { pauseMs: 0 })).toMatchObject({
      features: [],
      moves: 0,
    });
  });

  it("stops when asked and resumes at the moves that still lack the totals", async () => {
    await t.ctx.db.execute(sql`DELETE FROM processing_state WHERE key = 'features'`);
    await t.ctx.db.execute(
      sql`UPDATE segments SET features = features - 'wayTotals' WHERE kind = 'move'`,
    );
    const controller = new AbortController();
    const first = await runFeatureBackfill(t.ctx.db, {
      pauseMs: 0,
      signal: controller.signal,
      onDay: () => controller.abort(),
    });
    expect(first.complete).toBe(false);
    expect(first.days).toBe(1);
    const lacking = await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM segments WHERE kind = 'move' AND NOT features ? 'wayTotals'`,
    );
    expect(lacking.rows[0]?.n).toBeGreaterThan(0);
    const rest = await runFeatureBackfill(t.ctx.db, { pauseMs: 0 });
    expect(rest.complete).toBe(true);
    const done = await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM segments WHERE kind = 'move' AND NOT features ? 'wayTotals'`,
    );
    expect(done.rows[0]?.n).toBe(0);
  });

  it("starts again for a move left lacking after the marker, and gives way to the device's pass and to another fill", async () => {
    const [victim] = (
      await t.ctx.db.execute<{ id: string; device_id: string }>(
        sql`SELECT id, device_id FROM segments WHERE kind = 'move' LIMIT 1`,
      )
    ).rows;
    if (victim === undefined) throw new Error("no move");
    const lacks = async () =>
      (
        await t.ctx.db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM segments WHERE id = ${victim.id}::uuid AND NOT features ? 'wayTotals'`,
        )
      ).rows[0]?.n === 1;
    await t.ctx.db.execute(
      sql`UPDATE segments SET features = features - 'wayTotals' WHERE id = ${victim.id}::uuid`,
    );
    expect(await lacks()).toBe(true);

    // The device's processing lock is held (a pass at work): the fill waits for it.
    let filling: Promise<unknown> = Promise.resolve();
    await t.ctx.db.transaction(async (tx) => {
      await lockDeviceProcessing(tx, victim.device_id);
      filling = runFeatureBackfill(t.ctx.db, { pauseMs: 0 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await lacks()).toBe(true);
    });
    expect(await filling).toMatchObject({ features: ["wayTotals"], complete: true });
    expect(await lacks()).toBe(false);

    // Another process holds the fill: this one leaves it.
    await t.ctx.db.execute(
      sql`UPDATE segments SET features = features - 'wayTotals' WHERE id = ${victim.id}::uuid`,
    );
    let skipped: unknown = null;
    await t.ctx.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended('trail.feature-backfill', 0))`,
      );
      skipped = await runFeatureBackfill(t.ctx.db, { pauseMs: 0 });
    });
    expect(skipped).toMatchObject({ complete: false, skipped: true });
    expect(await lacks()).toBe(true);
    expect(await runFeatureBackfill(t.ctx.db, { pauseMs: 0 })).toMatchObject({ complete: true });
    expect(await lacks()).toBe(false);
  });
});
