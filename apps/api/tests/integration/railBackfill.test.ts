import { apiPaths } from "@trail/contracts/apiPaths";
import type { LevelTracksResponse } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { enqueueBackfill } from "../../src/processing/backfill";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import {
  enqueueWindow,
  queuePriority,
  takeDeviceWindows,
} from "../../src/processing/processingQueue";
import { processingVersions } from "../../src/processing/processingVersion";
import { processWindow } from "../../src/processing/processWindow";
import { RegionCoverageStore } from "../../src/processing/regionCoverageStore";
import { planWindow } from "../../src/processing/runPipeline";
import { parseTileKey } from "../../src/processing/tileCover";
import { saveTile } from "../../src/processing/tileStore";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { uploadJourney } from "../support/overlandPoints";
import { type Pass, PassRunner } from "../support/passRunner";
import {
  assertIdempotent,
  assertQueueInvariants,
  assertRailInvariants,
  assertSegmentInvariants,
} from "../support/processingInvariants";
import { importRailRegion, removeRailRegionBuilds } from "../support/railRegionBuild";
import { railTrip } from "../support/railTrips";
import { railWorld, roadLine, trackA } from "../support/railWorld";
import { resetDatabase } from "../support/resetDatabase";
import { lastT, stay, subPath, toXY, type Vertex } from "../support/syntheticWorld";
import { createTestContext } from "../support/testContext";

/*
 * The production-like scenario of the rail line (docs/architecture.md §17.3 and §17.4): ten days of
 * train rides as an older inference left them (inferred version 3, no rail places), a three-day
 * stop that no single pass may take on, map data missing for part of the line, and twenty live
 * uploads arriving while the backfill to inferred version 4 runs. The same scenario runs twice,
 * with the aligner on and off (`PROCESSING_RAIL_ALIGN`): what processing plans, grows and queues
 * must be identical, and so must everything the rail line does not own.
 *
 * The line (metres east of the origin): west of 45 km the Overpass cache holds the tiles, from
 * 50 km to 80 km only a loaded region covers them (the fixture source refuses them), east of that
 * nothing does until the fixture source is let to answer. Synthetic rides only.
 */
const budget = 20_000;
const older = { ...processingVersions, inferred: processingVersions.inferred - 1 };
const historyStart = 1_792_000_000;
const day = 86_400;
const liveStart = 1_793_100_000;
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();
const at = (epochSeconds: number) => new Date(epochSeconds * 1000);

type Third = "west" | "middle" | "east";
const stretch: Record<Third, [number, number]> = {
  west: [15_000, 35_000],
  middle: [55_000, 75_000],
  east: [82_000, 98_000],
};

interface Ride {
  third: Third;
  intervalS: number;
  messy?: boolean;
}

/** One ride a day, ten days: every third at 5 s, 60 s and 240 s, and a messy day. */
const rides: Ride[] = [
  { third: "west", intervalS: 5 },
  { third: "middle", intervalS: 5 },
  { third: "east", intervalS: 5 },
  { third: "west", intervalS: 60 },
  { third: "middle", intervalS: 60 },
  { third: "east", intervalS: 60 },
  { third: "west", intervalS: 240 },
  { third: "middle", intervalS: 240 },
  { third: "east", intervalS: 240 },
  { third: "west", intervalS: 5, messy: true },
];

/** The messy day: ±80 m noise, a two-point 1.5 km jump, a 4 min tunnel gap, a stretch along the road. */
function messyDay(startT: number): RawPoint[] {
  const path: Vertex[] = [
    ...subPath(trackA, 1000, 2000),
    ...roadLine,
    ...subPath(trackA, 5000, 9000),
  ];
  const points = railTrip(path, {
    startT,
    intervalS: 5,
    noiseM: 40,
    accuracy: 60,
    seed: 9,
  });
  const jump = 1500 / 111_195;
  const middle = Math.floor(points.length / 2);
  return points
    .filter((point) => point.t < startT + 200 || point.t > startT + 440)
    .map((point, index) =>
      index === middle || index === middle + 1 ? { ...point, lat: point.lat + jump } : point,
    );
}

function history(): RawPoint[] {
  const legs = rides.map((ride, index) => {
    const startT = historyStart + index * day;
    if (ride.messy === true) return messyDay(startT);
    const [from, to] = stretch[ride.third];
    return railTrip(subPath(trackA, from, to), {
      startT,
      intervalS: ride.intervalS,
      noiseM: 6,
      accuracy: 10,
      seed: index + 1,
    });
  });
  const points = legs.flat();
  // A three-day stop at the end of the last ride, a point every ten seconds.
  const last = points.at(-1);
  if (last === undefined) throw new Error("no history");
  const place = toXY(last);
  const days = stay(place, { startT: last.t + 10, durationS: 3 * day, intervalS: 10, seed: 61 });
  return [...points, ...days];
}

/** The live train: twenty uploads three minutes apart, the first two of the phone at rest. */
function liveRide(): RawPoint[] {
  return railTrip(subPath(trackA, 500, 43_500), {
    startT: liveStart + 360,
    intervalS: 5,
    speedMs: 12,
    noiseM: 6,
    accuracy: 10,
    dwellS: 360,
    seed: 70,
  });
}

/** The rail ways of the rail world as lines in metres, to say whether a served vertex lies on one. */
const railLines: Vertex[][] = railWorld()
  .ways.filter((way) => way.kind === "rail")
  .map((way) => way.geometry.map(([lon, lat]) => toXY({ lon, lat })));

function distanceToRails([x, y]: Vertex): number {
  let best = Number.POSITIVE_INFINITY;
  for (const line of railLines) {
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1];
      const b = line[index];
      if (a === undefined || b === undefined) continue;
      const length2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const f =
        length2 === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / length2),
            );
      best = Math.min(
        best,
        Math.hypot(x - (a[0] + f * (b[0] - a[0])), y - (a[1] + f * (b[1] - a[1]))),
      );
    }
  }
  return best;
}

interface PassRecord {
  rows: [number, string, string, string, string][];
  window: [string, string];
  points: number;
  segments: number;
  split: boolean;
  missingTiles: number;
  queue: unknown[];
  ms: number;
}

interface Outcome {
  passes: PassRecord[];
  /** Everything the rail line does not own, as the end of the scenario left it. */
  state: unknown;
  /** The moves with their verdicts, by day (history) and for the live ride. */
  verdicts: Record<
    string,
    { mode: string | null; status: string | null; source: string | null; reason: string | null }
  >;
  liveAlignedFrom: number | null;
  bar: { maxPassMs: number };
}

const directoriesToClean: (() => void)[] = [removeRailRegionBuilds];
afterAll(() => {
  for (const clean of directoriesToClean) clean();
});

async function scenario(railAlign: boolean): Promise<Outcome> {
  await resetDatabase();
  const fixture = new FixtureWaySource(railWorld());
  const env = { PROCESSING_PASS_MAX_POINTS: String(budget) };

  // 1. The history as the inference before this one left it: processed with the aligner off,
  // its segments then marked as that inference's, as `processingService.test.ts` does.
  const past = await createTestContext({
    waySource: fixture,
    env: { ...env, PROCESSING_RAIL_ALIGN: "false" },
  });
  const { agent: owner, cookie } = await signUpWithCookie(past.app, "first@example.com");
  const created = await createDevice(owner, { name: "Commuter" });
  const device = { id: created.device.id, token: created.credentials.accessToken };
  const points = history();
  await uploadJourney(past.app, device.token, points);
  await past.ctx.background.drain(5000);
  await past.ctx.processing.flush();
  // The uploads' windows met in the order the clock gave them; the history is worked out once
  // more as one job, so that it is the same in every run of this scenario.
  await past.ctx.db.execute(sql`DELETE FROM processing_queue`);
  await enqueueWindow(past.ctx.db, {
    deviceId: device.id,
    from: at((points[0]?.t ?? 0) - 1800),
    to: at(lastT(points) + 1800),
    reason: "reprocess",
    fromLevel: "averaged",
  });
  await past.ctx.processing.flush();
  const config = past.ctx.processing.config;
  // The tiles of the middle and the east are not in the cache any more (the extract is the region's).
  const refused = new Set<string>();
  const live = liveRide();
  for (const [index, ride] of rides.entries()) {
    if (ride.third === "west") continue;
    const [from, to] = stretch[ride.third];
    const ridePoints = railTrip(subPath(trackA, from, to), {
      startT: historyStart + index * day,
      intervalS: ride.intervalS,
    });
    for (const tile of planWindow(ridePoints, [], config).tiles) {
      if (ride.third === "middle") refused.add(tile);
    }
  }
  const eastTiles = new Set<string>();
  for (const [index, ride] of rides.entries()) {
    if (ride.third !== "east") continue;
    const [from, to] = stretch.east;
    const ridePoints = railTrip(subPath(trackA, from, to), {
      startT: historyStart + index * day,
      intervalS: ride.intervalS,
    });
    for (const tile of planWindow(ridePoints, [], config).tiles) eastTiles.add(tile);
  }
  for (const tile of [...refused, ...eastTiles]) {
    const address = parseTileKey(tile);
    if (address === null) continue;
    await past.ctx.db.execute(sql`
      DELETE FROM osm_tile_ways WHERE z = ${address.z} AND x = ${address.x} AND y = ${address.y}
    `);
    await past.ctx.db.execute(sql`
      DELETE FROM osm_tiles WHERE z = ${address.z} AND x = ${address.x} AND y = ${address.y}
    `);
  }
  // The live ride's tiles are the cache's (west of 45 km).
  for (const tile of planWindow(live, [], config).tiles) {
    const address = parseTileKey(tile);
    if (address !== null) {
      await saveTile(past.ctx.db, address, await fixture.fetchTile(address), new Date());
    }
  }
  await past.ctx.dailyStats.flush();
  await past.ctx.db.execute(sql`DELETE FROM processing_queue`);
  await past.ctx.db.execute(
    sql`UPDATE segments SET version = ${older.inferred} WHERE device_id = ${device.id}`,
  );
  await past.ctx.db.execute(sql`
    INSERT INTO processing_state (key, value) VALUES ('backfill', ${JSON.stringify({ versions: older })}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `);
  await past.close();

  // 2. Missing map data: the source refuses the middle and the east, a region covers the middle.
  for (const tile of [...refused, ...eastTiles]) fixture.failing.add(tile);
  const t = await createTestContext({
    waySource: fixture,
    env: { ...env, PROCESSING_RAIL_ALIGN: String(railAlign) },
  });
  await importRailRegion(t.ctx.db, { westM: 45_000, eastM: 80_000 });
  expect((await enqueueBackfill(t.ctx.db, processingVersions)).fromLevel).toBe("inferred");
  const stalePoints = async () =>
    (
      await t.ctx.db.execute<{ points: number }>(sql`
        SELECT coalesce(sum(point_count), 0)::int AS points FROM segments
        WHERE device_id = ${device.id} AND version < ${processingVersions.inferred}
      `)
    ).rows[0]?.points ?? 0;
  expect(await stalePoints()).toBeGreaterThan(25_000);

  // 3. Twenty live uploads, each worked out as the worker does, with the backfill in between.
  const records: PassRecord[] = [];
  const uploads: { from: Date; to: Date }[] = [];
  let liveAlignedFrom: number | null = null;
  let maxPassMs = 0;
  const snapshot = async () =>
    (
      await t.ctx.db.execute(sql`
        SELECT from_at::text, to_at::text, priority, reason, from_level, missing_tiles IS NOT NULL AS waiting
        FROM processing_queue ORDER BY from_at, to_at
      `)
    ).rows;
  const windowOf = (pass: Pass) => ({ from: pass.outcome.from, to: pass.outcome.to });
  const runner: PassRunner = new PassRunner({
    db: t.ctx.db,
    config: t.ctx.processing.config,
    mapping: true,
    regions: new RegionCoverageStore(),
    after: async (pass) => {
      expect(pass.outcome.points).toBeLessThanOrEqual(budget);
      await assertSegmentInvariants(t.ctx.db, device.id, { finished: runner.log.map(windowOf) });
      await assertQueueInvariants(t.ctx.db, { deviceId: device.id, uploads });
      await assertRailInvariants(t.ctx.db, device.id);
      maxPassMs = Math.max(maxPassMs, pass.ms);
      records.push({
        rows: pass.rows.map((row) => [
          row.priority,
          row.reason,
          row.fromLevel,
          row.from.toISOString(),
          row.to.toISOString(),
        ]),
        window: [pass.outcome.from.toISOString(), pass.outcome.to.toISOString()],
        points: pass.outcome.points,
        segments: pass.outcome.segments,
        split: pass.outcome.split,
        missingTiles: pass.outcome.missingTiles.length,
        queue: await snapshot(),
        ms: pass.ms,
      });
    },
  });
  const remaining = [await stalePoints()];
  let lastLive: Pass | null = null;
  const verdictOfLive = async () =>
    (
      await t.ctx.db.execute<{ status: string | null }>(sql`
        SELECT features->'railPath'->>'status' AS status FROM segments
        WHERE device_id = ${device.id} AND kind = 'move' AND started_at >= ${iso(liveStart)}::timestamptz
        ORDER BY started_at DESC LIMIT 1
      `)
    ).rows[0]?.status ?? null;
  for (let index = 0; index < 20; index += 1) {
    const batch = live.filter(
      (point) => point.t >= liveStart + index * 180 && point.t < liveStart + (index + 1) * 180,
    );
    await uploadJourney(t.app, device.token, batch);
    await t.ctx.background.drain(5000);
    uploads.push({ from: at((batch[0]?.t ?? 0) - 1800), to: at(lastT(batch) + 1800) });
    const livePass = await runner.next();
    if (livePass === null) throw new Error("the upload was not worked out");
    // The upload alone, with the bounds it was queued with: never grown, never earlier.
    const queued = uploads.at(-1);
    expect(livePass.rows.map((row) => [row.priority, row.from, row.to])).toEqual([
      [queuePriority.live, queued?.from, queued?.to],
    ]);
    lastLive = livePass;
    const status = await verdictOfLive();
    if (railAlign && status === "aligned" && liveAlignedFrom === null) liveAlignedFrom = index;
    if (liveAlignedFrom !== null) expect(status, `live upload ${index}`).toBe("aligned");
    await runner.next((rows) => rows.every((row) => row.priority !== queuePriority.live));
    remaining.push(await stalePoints());
  }
  const done = remaining.indexOf(0);
  for (let index = 1; index <= (done < 0 ? remaining.length - 1 : done); index += 1) {
    expect(remaining[index], `old points after upload ${index}: ${remaining}`).toBeLessThan(
      remaining[index - 1] ?? 0,
    );
  }
  await runner.drain();
  await assertSegmentInvariants(t.ctx.db, device.id, {
    current: true,
    finished: runner.log.map(windowOf),
  });
  await assertQueueInvariants(t.ctx.db, { deviceId: device.id, uploads });

  // 4. Before the tiles are allowed: the middle's trains are aligned from the region, the east's wait.
  const verdicts = async () => {
    const rows = await t.ctx.db.execute<{
      day: number;
      mode: string | null;
      status: string | null;
      source: string | null;
      reason: string | null;
    }>(sql`
      SELECT floor((extract(epoch FROM started_at) - ${historyStart} + 3600) / ${day})::int AS day, mode,
        features->'railPath'->>'status' AS status, features->'railPath'->>'source' AS source,
        features->'railPath'->>'reason' AS reason
      FROM segments WHERE device_id = ${device.id} AND kind = 'move' AND started_at < ${iso(liveStart)}::timestamptz
      ORDER BY started_at
    `);
    const result: Outcome["verdicts"] = {};
    for (const row of rows.rows) {
      result[`day ${row.day}`] = {
        mode: row.mode,
        status: row.status,
        source: row.source,
        reason: row.reason,
      };
    }
    return result;
  };
  const before = await verdicts();
  if (railAlign) {
    for (const [index, ride] of rides.entries()) {
      if (ride.intervalS > 60 || ride.messy === true) continue;
      const verdict = before[`day ${index}`];
      if (ride.third === "west")
        expect(verdict).toMatchObject({ status: "aligned", source: "cache" });
      if (ride.third === "middle") {
        expect(verdict).toMatchObject({ status: "aligned", source: "region" });
      }
      if (ride.third === "east") {
        expect(verdict).toMatchObject({ status: "no_map", reason: "waiting" });
      }
    }
  } else {
    expect(Object.values(before).every((verdict) => verdict.status === null)).toBe(true);
  }

  // The east's tiles are let through: its waiting windows complete.
  for (const tile of eastTiles) fixture.failing.delete(tile);
  await t.ctx.db.execute(
    sql`UPDATE osm_tiles SET retry_at = now() - interval '1 minute' WHERE status = 'failed'`,
  );
  await t.ctx.processing.flush();
  const after = await verdicts();
  await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
  await assertRailInvariants(t.ctx.db, device.id);

  // 5. The end state.
  if (railAlign) {
    for (const [index, ride] of rides.entries()) {
      if (ride.third !== "east" || ride.intervalS > 60) continue;
      expect(after[`day ${index}`], `day ${index}`).toMatchObject({
        status: "aligned",
        source: "cache",
      });
    }
    const answer = await request(t.app)
      .get(apiPaths.v1.tracks)
      .set("Cookie", cookie)
      .query({
        from: iso(historyStart - 3600),
        to: iso(liveStart + 4 * 3600),
        devices: device.id,
        level: "inferred",
        maxPoints: 50_000,
      })
      .expect(200);
    const segments = (answer.body as LevelTracksResponse).segments;
    const aligned = segments.filter((segment) => segment.alignedTo === "rail");
    expect(aligned.length).toBeGreaterThanOrEqual(6);
    for (const segment of aligned) {
      expect(segment.mode, "only a train is served aligned").toBe("train");
      for (const point of segment.points) {
        expect(distanceToRails(toXY({ lon: point[0], lat: point[1] }))).toBeLessThan(1);
      }
    }
    expect(segments.some((segment) => segment.kind === "move" && segment.alignedTo === null)).toBe(
      true,
    );
  }
  // A finished pass again changes nothing, rail columns included (I6).
  if (lastLive !== null) {
    const pass = lastLive;
    await assertIdempotent(t.ctx.db, device.id, windowOf(pass), async () => {
      await enqueueWindow(t.ctx.db, {
        deviceId: device.id,
        ...pass.outcome.queued,
        reason: "reprocess",
        fromLevel: "averaged",
      });
      const rows = await takeDeviceWindows(
        t.ctx.db,
        device.id,
        pass.outcome.queued.from,
        pass.outcome.queued.to,
      );
      await processWindow(t.ctx.db, rows, {
        config: t.ctx.processing.config,
        mapping: true,
        regions: new RegionCoverageStore(),
        now: new Date(),
      });
    });
  }
  // What the rail line does not own: segments without their verdict and the mapped levels.
  const state = (
    await t.ctx.db.execute(sql`
      SELECT
        (SELECT jsonb_agg(jsonb_build_object('kind', kind, 'start', started_at, 'end', ended_at,
           'mode', mode, 'inferred', mode_inferred, 'confidence', confidence, 'review', review,
           'distance', distance_m, 'points', point_count, 'features', features - 'railPath')
           ORDER BY started_at) FROM segments WHERE device_id = ${device.id}) AS segments,
        (SELECT md5(string_agg(concat_ws('|', recorded_at, kept, lat_avg, lon_avg, speed_avg,
           lat_map, lon_map, way_id, way_kind, snap_m, path_map::text, version), ','
           ORDER BY recorded_at)) FROM processed_points WHERE device_id = ${device.id}) AS points
    `)
  ).rows[0];
  await t.close();
  return {
    passes: records,
    state,
    verdicts: after,
    liveAlignedFrom,
    bar: { maxPassMs },
  };
}

describe("trains drawn along the railway while the history is reworked", () => {
  it("align where map data is, wait where it is not, and change nothing about how processing runs", {
    timeout: 1_800_000,
  }, async () => {
    const on = await scenario(true);
    const off = await scenario(false);
    // The live train was aligned from some upload on, and stayed aligned.
    expect(on.liveAlignedFrom).not.toBeNull();
    expect(off.liveAlignedFrom).toBeNull();
    // B4: every pass took the same rows, worked the same window, read the same points and left
    // the same queue, with the aligner on and off; so did the end of the run.
    const plan = (run: Outcome) => run.passes.map(({ ms: _ms, ...pass }) => pass);
    expect(plan(on)).toEqual(plan(off));
    expect(on.state).toEqual(off.state);
    // The cost: no pass of the run is slow (B6's bound for a pass); the times are in the message.
    const times = on.passes.map((pass) => Math.round(pass.ms)).join(" ");
    expect(on.bar.maxPassMs, `pass times in ms with the aligner on: ${times}`).toBeLessThan(5000);
  });
});
