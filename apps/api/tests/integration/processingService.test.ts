import { apiPaths } from "@trail/contracts/apiPaths";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toIso } from "../../src/db/toIso";
import { enqueueBackfill } from "../../src/processing/backfill";
import { persistWindow } from "../../src/processing/persistWindow";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import {
  enqueueWindow,
  livePassIntervalMs,
  queuePriority,
  retryWindows,
  takeDeviceWindows,
  takeNextWindow,
} from "../../src/processing/processingQueue";
import { processingVersions } from "../../src/processing/processingVersion";
import { processWindow } from "../../src/processing/processWindow";
import { planWindow, type WindowResult } from "../../src/processing/runPipeline";
import { parseTileKey } from "../../src/processing/tileCover";
import { extendWindow, seamPoints } from "../../src/processing/windowData";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { type Pass, PassRunner } from "../support/passRunner";
import {
  assertIdempotent,
  assertQueueInvariants,
  assertSegmentInvariants,
} from "../support/processingInvariants";
import { resetDatabase } from "../support/resetDatabase";
import { concat, lastT, stay, toXY, travel, type Vertex } from "../support/syntheticWorld";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * Processing in bounded passes (docs/architecture.md §17.4): a job too big
 * for one pass is split at its largest gaps, a window grows to whole segments
 * within the budget, a device's live passes keep their interval, and the
 * work goes live, repair, backfill — after every pass, the invariants of
 * incremental processing hold (support/processingInvariants.ts).
 */

/** The budget the tests run with (PROCESSING_PASS_MAX_POINTS): a few days of points exceed it. */
const budget = 20_000;

let t: TestContext;
const fixture = new FixtureWaySource();
let owner: Agent;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({
    waySource: fixture,
    env: { PROCESSING_PASS_MAX_POINTS: String(budget) },
  });
  ({ agent: owner } = await signUpWithCookie(t.app, "first@example.com"));
});

afterAll(async () => {
  await t.close();
});

interface Range {
  from: Date;
  to: Date;
}

const at = (epochSeconds: number) => new Date(epochSeconds * 1000);

async function newDevice(name: string) {
  const device = await createDevice(owner, { name });
  return { id: device.device.id, token: device.credentials.accessToken };
}

/** Uploads points as the phone does and waits for the queueing that runs after the response. */
async function upload(token: string, points: readonly RawPoint[], context = t) {
  await uploadJourney(context.app, token, points);
  await context.ctx.background.drain(5000);
}

/** The window an upload queues: its points, half an hour on either side. */
const queuedFor = (points: readonly RawPoint[]): Range => ({
  from: at((points[0]?.t ?? 0) - 1800),
  to: at(lastT(points) + 1800),
});

/** The recorded points of a device in a range, its ends included. */
async function pointsIn(deviceId: string, range: Range, context = t): Promise<number> {
  const result = await context.ctx.db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM locations
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${range.from.toISOString()}::timestamptz
      AND recorded_at <= ${range.to.toISOString()}::timestamptz
  `);
  return result.rows[0]?.count ?? 0;
}

/** How long the device's points in a range span, in seconds. */
async function spanOf(deviceId: string, range: Range, context = t): Promise<number> {
  const result = await context.ctx.db.execute<{ seconds: number | null }>(sql`
    SELECT extract(epoch FROM max(recorded_at) - min(recorded_at))::float8 AS seconds FROM locations
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${range.from.toISOString()}::timestamptz
      AND recorded_at <= ${range.to.toISOString()}::timestamptz
  `);
  return result.rows[0]?.seconds ?? 0;
}

/** The span of the rows a pass took. */
const rowsSpan = (pass: Pass): Range => ({
  from: new Date(Math.min(...pass.rows.map((row) => row.from.getTime()))),
  to: new Date(Math.max(...pass.rows.map((row) => row.to.getTime()))),
});

/** The window a pass worked out. */
const windowOf = (pass: Pass): Range => ({ from: pass.outcome.from, to: pass.outcome.to });

/** What a pass did, for the failure messages. */
const described = (pass: Pass) =>
  `${pass.rows.map((row) => row.reason).join("+")} pass ${pass.outcome.queued.from.toISOString()}…${pass.outcome.queued.to.toISOString()}`;

/** The pass log, a line a pass: what it took, read and wrote, how long it took. */
const passLog = (passes: readonly Pass[]) =>
  passes
    .map(
      (pass) =>
        `${described(pass)}: window ${pass.outcome.from.toISOString()}…${pass.outcome.to.toISOString()}, ${pass.outcome.points} points, ${pass.outcome.segments} segments${pass.outcome.split ? ", split" : ""}, ${Math.round(pass.ms)} ms`,
    )
    .join("\n");

/** Every pass reads at most the budget, of a queued part within the caps. */
async function expectWithinBudget(
  deviceId: string,
  pass: Pass,
  context = t,
  maxSpanS = context.ctx.processing.config.passes.maxSpanS,
): Promise<void> {
  expect(pass.outcome.points, described(pass)).toBeLessThanOrEqual(budget);
  expect(
    await pointsIn(deviceId, pass.outcome.queued, context),
    described(pass),
  ).toBeLessThanOrEqual(budget);
  expect(await spanOf(deviceId, pass.outcome.queued, context), described(pass)).toBeLessThanOrEqual(
    maxSpanS,
  );
}

/** Where the twelve days are spent: at home and at work, 4.8 km apart by bike. */
const home: Vertex = [-1000, -200];
const work: Vertex = [-1000, 4600];

/**
 * Days of a phone recording densely: the morning at home, the ride to work,
 * the day there (every other day with the phone off for 45 minutes), the ride
 * back and the evening, then nothing all night, nine to ten and a half hours
 * — the gaps a job too big for one pass is split at.
 */
function daysOfRecording(startT: number, days: number): RawPoint[] {
  const legs: RawPoint[][] = [];
  for (let day = 0; day < days; day += 1) {
    const seed = 1000 + day * 10;
    const wake = startT + day * 86_400 + ((day * 37) % 90) * 60;
    const morningAtHome = stay(home, { startT: wake, durationS: 1800, intervalS: 10, seed });
    const there = travel([home, work], {
      startT: lastT(morningAtHome) + 5,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: seed + 1,
    });
    const office = stay(work, {
      startT: lastT(there) + 5,
      durationS: 8 * 3600,
      intervalS: 12,
      seed: seed + 2,
    });
    const phoneOff = lastT(there) + 3 * 3600;
    const atWork =
      day % 2 === 0
        ? office.filter((point) => point.t < phoneOff || point.t > phoneOff + 2700)
        : office;
    const back = travel([work, home], {
      startT: lastT(office) + 5,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: seed + 3,
    });
    const evening = stay(home, {
      startT: lastT(back) + 5,
      durationS: 5 * 3600,
      intervalS: 8,
      seed: seed + 4,
    });
    legs.push(morningAtHome, there, atWork, back, evening);
  }
  return concat(...legs);
}

/** The recording gaps longer than half an hour in a range, the longest first: where they end. */
async function gapsIn(deviceId: string, range: Range, context = t) {
  const result = await context.ctx.db.execute<{ ends: string; seconds: number }>(sql`
    SELECT recorded_at::text AS ends, seconds FROM (
      SELECT recorded_at,
        extract(epoch FROM recorded_at - lag(recorded_at) OVER (ORDER BY recorded_at))::float8 AS seconds
      FROM locations
      WHERE device_id = ${deviceId}
        AND recorded_at >= ${range.from.toISOString()}::timestamptz
        AND recorded_at <= ${range.to.toISOString()}::timestamptz
    ) g
    WHERE seconds > 1800
    ORDER BY seconds DESC, recorded_at
  `);
  return result.rows.map((row) => ({ ends: new Date(toIso(row.ends)), seconds: row.seconds }));
}

/** The last recorded point of a device before `at`. */
async function pointBefore(deviceId: string, at: Date, context = t): Promise<Date> {
  const result = await context.ctx.db.execute<{ at: string }>(sql`
    SELECT recorded_at::text AS at FROM locations
    WHERE device_id = ${deviceId} AND recorded_at < ${at.toISOString()}::timestamptz
    ORDER BY recorded_at DESC LIMIT 1
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("no point before");
  return new Date(toIso(row.at));
}

/** The `count`-th point of a range from its end (1 = the last). */
async function pointFromEnd(deviceId: string, range: Range, count: number, context = t) {
  const result = await context.ctx.db.execute<{ at: string }>(sql`
    SELECT recorded_at::text AS at FROM locations
    WHERE device_id = ${deviceId}
      AND recorded_at >= ${range.from.toISOString()}::timestamptz
      AND recorded_at <= ${range.to.toISOString()}::timestamptz
    ORDER BY recorded_at DESC OFFSET ${count - 1} LIMIT 1
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("no such point");
  return new Date(toIso(row.at));
}

/** Runs a finished pass again: its queued part, as `trail reprocess` queues a range. */
async function runAgain(deviceId: string, pass: Pass, context = t): Promise<void> {
  await enqueueWindow(context.ctx.db, {
    deviceId,
    ...pass.outcome.queued,
    reason: "reprocess",
    fromLevel: "averaged",
  });
  const rows = await takeDeviceWindows(
    context.ctx.db,
    deviceId,
    pass.outcome.queued.from,
    pass.outcome.queued.to,
  );
  await processWindow(context.ctx.db, rows, {
    config: context.ctx.processing.config,
    mapping: context.ctx.processing.mapping,
    now: new Date(),
  });
}

describe("a job too big for one pass", () => {
  it("is split at its largest gaps into passes within the budget, the newest live", {
    timeout: 600_000,
  }, async () => {
    // Twelve days at a budget of 20 000 points, as production's 575 000 at 60 000: the points bind.
    const lines: Record<string, unknown>[] = [];
    const context = await createTestContext({
      waySource: null,
      env: {
        PROCESSING_PASS_MAX_POINTS: String(budget),
        PROCESSING_PASS_MAX_SPAN_HOURS: "96",
      },
      logDestination: { write: (line: string) => lines.push(JSON.parse(line)) },
    });
    try {
      const device = await newDevice("Twelve days");
      const points = daysOfRecording(morning - 200 * 86_400, 12);
      expect(points.length).toBeGreaterThan(65_000);
      await upload(device.token, points, context);
      // As in production on 28 October: one upload's window over all twelve days.
      await context.ctx.db.execute(
        sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`,
      );
      const job = queuedFor(points);
      await enqueueWindow(context.ctx.db, { deviceId: device.id, ...job, reason: "ingest" });

      const runner = new PassRunner({
        db: context.ctx.db,
        config: context.ctx.processing.config,
        mapping: false,
        after: async (pass) => {
          await expectWithinBudget(device.id, pass, context, 96 * 3600);
          await assertSegmentInvariants(context.ctx.db, device.id);
          await assertQueueInvariants(context.ctx.db, { deviceId: device.id, uploads: [job] });
        },
      });
      const first = await runner.next();
      if (first === null) throw new Error("nothing queued");
      // The newest part, live, at once, from the morning after a night; the older part waits as
      // repair, of the same level, until the evening before.
      expect(first.rows.map((row) => row.priority)).toEqual([queuePriority.live]);
      expect(first.outcome.split).toBe(true);
      expect(first.outcome.queued.to).toEqual(job.to);
      const evening = await pointBefore(device.id, first.outcome.queued.from, context);
      expect(first.outcome.queued.from.getTime() - evening.getTime()).toBeGreaterThan(
        8 * 3_600_000,
      );
      // The night is worked out with both its ends: the pass reaches back to the evening's point.
      expect(first.outcome.from).toEqual(evening);
      const waiting = await context.ctx.db.execute<{
        from_at: string;
        to_at: string;
        reason: string;
        priority: number;
        from_level: string;
      }>(sql`
        SELECT from_at::text, to_at::text, reason, priority, from_level FROM processing_queue
        WHERE device_id = ${device.id}
      `);
      expect(
        waiting.rows.map((row) => ({
          ...row,
          from_at: new Date(toIso(row.from_at)),
          to_at: new Date(toIso(row.to_at)),
        })),
      ).toEqual([
        {
          from_at: job.from,
          to_at: evening,
          reason: "split",
          priority: queuePriority.repair,
          from_level: "averaged",
        },
      ]);
      // I6: the pass, run again on what it wrote, changes nothing.
      await assertIdempotent(context.ctx.db, device.id, windowOf(first), () =>
        runAgain(device.id, first, context),
      );
      const passes = [first, ...(await runner.drain())];

      // Each split at the longest gap that leaves a newest part within the budget (less the points
      // kept for the window's seams), and half of it.
      for (const pass of passes.filter((entry) => entry.outcome.split)) {
        const part = rowsSpan(pass);
        const capacity = budget - seamPoints;
        const earliest = await pointFromEnd(device.id, part, capacity, context);
        const halfway = await pointFromEnd(device.id, part, Math.ceil(capacity / 2), context);
        const before = await pointBefore(device.id, earliest, context);
        const [longest] = (await gapsIn(device.id, { from: before, to: part.to }, context)).filter(
          (gap) => gap.ends >= earliest && gap.ends <= halfway,
        );
        expect(longest?.seconds, described(pass)).toBeGreaterThan(8 * 3600);
        expect(pass.outcome.queued.from, described(pass)).toEqual(longest?.ends);
      }
      // About a pass per three days: as many as the budget asks, fewer than the days.
      expect(passes.length).toBeGreaterThanOrEqual(Math.ceil(points.length / budget));
      expect(passes.length).toBeLessThan(12);
      expect(
        passes.slice(1).every((pass) => pass.rows.every((row) => row.reason === "split")),
      ).toBe(true);
      // Everything worked out, every point once: the segments meet across the splits.
      const unprocessed = await context.ctx.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM locations l
        WHERE l.device_id = ${device.id} AND NOT EXISTS (
          SELECT 1 FROM processed_points p
          WHERE p.device_id = l.device_id AND p.recorded_at = l.recorded_at)
      `);
      expect(unprocessed.rows[0]?.count).toBe(0);
      await assertSegmentInvariants(context.ctx.db, device.id, { current: true });
      const left = await context.ctx.db.execute(
        sql`SELECT 1 FROM processing_queue WHERE device_id = ${device.id}`,
      );
      expect(left.rows).toEqual([]);
      // The nights are stops, all of them: twelve days, a stop at each end of each ride.
      const stops = await context.ctx.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM segments WHERE device_id = ${device.id} AND kind = 'stop'
      `);
      expect(stops.rows[0]?.count).toBe(2 * 12 + 1);

      // The worker passes the same: its log line for every pass, the split marked.
      await context.ctx.db.execute(sql`DELETE FROM segments WHERE device_id = ${device.id}`);
      await context.ctx.db.execute(
        sql`DELETE FROM processed_points WHERE device_id = ${device.id}`,
      );
      await enqueueWindow(context.ctx.db, { deviceId: device.id, ...job, reason: "ingest" });
      lines.length = 0;
      await context.ctx.processing.flush();
      const logged = lines.filter((line) => line["msg"] === "processing window done");
      expect(logged.map((line) => line["points"])).toEqual(
        passes.map((pass) => pass.outcome.points),
      );
      expect(logged.map((line) => line["split"])).toEqual(passes.map((pass) => pass.outcome.split));
      await assertSegmentInvariants(context.ctx.db, device.id, { current: true });
    } finally {
      await context.close();
    }
  });

  it("is split at the budget's point boundary where no gap is long enough, and by its span", {
    timeout: 300_000,
  }, async () => {
    // Thirty hours without a gap of half an hour: a point every five seconds at a desk.
    const device = await newDevice("Thirty hours at a desk");
    const start = morning - 210 * 86_400;
    const desk = stay(work, { startT: start, durationS: 30 * 3600, intervalS: 5, seed: 41 });
    await upload(device.token, desk);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    const job = { from: at(start), to: at(lastT(desk)) };
    await enqueueWindow(t.ctx.db, { deviceId: device.id, ...job, reason: "delete" });
    const runner = new PassRunner({
      db: t.ctx.db,
      config: t.ctx.processing.config,
      mapping: false,
      after: async (pass) => {
        await expectWithinBudget(device.id, pass);
        await assertSegmentInvariants(t.ctx.db, device.id);
        await assertQueueInvariants(t.ctx.db, { deviceId: device.id });
      },
    });
    const passes = await runner.drain();
    // 21 601 points: the newest 20 000 first, at a point boundary; the rest after, repair as queued.
    expect(passes.map((pass) => pass.outcome.split)).toEqual([true, false]);
    expect(passes[0]?.outcome.queued.from).toEqual(
      await pointFromEnd(device.id, job, budget - seamPoints),
    );
    expect(passes[1]?.rows.map((row) => [row.reason, row.priority])).toEqual([
      ["delete", queuePriority.repair],
    ]);
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });

    // Forty hours of a sparse phone: few points, but longer than a pass may span (36 hours).
    const sparse = await newDevice("Forty hours, sparse");
    const days = stay(home, { startT: start, durationS: 40 * 3600, intervalS: 600, seed: 42 });
    await upload(sparse.token, days);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${sparse.id}`);
    const long = { from: at(start), to: at(lastT(days)) };
    await enqueueWindow(t.ctx.db, { deviceId: sparse.id, ...long, reason: "delete" });
    const spans = new PassRunner({
      db: t.ctx.db,
      config: t.ctx.processing.config,
      mapping: false,
      after: async (pass) => {
        await expectWithinBudget(sparse.id, pass);
        await assertSegmentInvariants(t.ctx.db, sparse.id);
      },
    });
    const parts = await spans.drain();
    expect(parts.map((pass) => pass.outcome.split)).toEqual([true, false]);
    // The newest part from the first point of the last 36 hours.
    expect(parts[0]?.outcome.queued.from).toEqual(at(start + 4 * 3600));
    await assertSegmentInvariants(t.ctx.db, sparse.id, { current: true });
  });
});

describe("every split", () => {
  it("makes headway: a hole is split at once and never again, two points are no work", {
    timeout: 120_000,
  }, async () => {
    // Four days at a point every six minutes, an hour deleted on the third: longer than a pass.
    const device = await newDevice("Four days with a hole");
    const start = morning - 260 * 86_400;
    const hole = start + 2 * 86_400;
    const days = stay(home, { startT: start, durationS: 4 * 86_400, intervalS: 360, seed: 71 });
    await upload(
      device.token,
      days.filter((point) => point.t < hole || point.t > hole + 3600),
    );
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    const job = { from: at(start), to: at(lastT(days)) };
    await enqueueWindow(t.ctx.db, { deviceId: device.id, ...job, reason: "delete" });
    const runner = new PassRunner({
      db: t.ctx.db,
      config: t.ctx.processing.config,
      mapping: false,
      after: async (pass) => {
        await expectWithinBudget(device.id, pass);
        await assertSegmentInvariants(t.ctx.db, device.id);
      },
    });
    const passes = await runner.drain(10);
    expect(passes.length, passLog(passes)).toBeLessThanOrEqual(5);
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
    // The hour without points lay at the same place: one stop over it.
    const across = await t.ctx.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM segments
      WHERE device_id = ${device.id} AND kind = 'stop'
        AND started_at < to_timestamp(${hole}) AND ended_at > to_timestamp(${hole + 3600})
    `);
    expect(across.rows[0]?.count).toBe(1);

    // Two points forty hours apart, the job starting at the first: worked out at once, unsplit.
    const pair = await newDevice("Two points");
    const two = [
      ...stay(home, { startT: start, durationS: 0, intervalS: 60, seed: 72 }),
      ...stay(home, { startT: start + 40 * 3600, durationS: 0, intervalS: 60, seed: 73 }),
    ];
    await upload(pair.token, two);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${pair.id}`);
    await enqueueWindow(t.ctx.db, {
      deviceId: pair.id,
      from: at(start),
      to: at(start + 40 * 3600),
      reason: "delete",
    });
    const once = await new PassRunner({
      db: t.ctx.db,
      config: t.ctx.processing.config,
      mapping: false,
    }).drain(3);
    expect(once.map((pass) => [pass.outcome.split, pass.outcome.points])).toEqual([[false, 2]]);
  });
});

describe("a window's growth within the budget", () => {
  it("takes the segments at its edges whole or not at all, forward first, cut at points", {
    timeout: 120_000,
  }, async () => {
    const device = await newDevice("Edges");
    const start = morning - 220 * 86_400;
    const before = stay(home, { startT: start, durationS: 3600, intervalS: 10, seed: 51 });
    const ride = travel([home, work], {
      startT: lastT(before) + 5,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 52,
    });
    const after = stay(work, { startT: lastT(ride) + 5, durationS: 3600, intervalS: 10, seed: 53 });
    await upload(device.token, concat(before, ride, after));
    await t.ctx.processing.flush();
    const segments = async () =>
      (
        await t.ctx.db.execute<{ kind: string; from: number; to: number; points: number }>(sql`
          SELECT kind, extract(epoch FROM started_at)::float8 AS from,
            extract(epoch FROM ended_at)::float8 AS to, point_count AS points
          FROM segments WHERE device_id = ${device.id} ORDER BY started_at
        `)
      ).rows;
    const [, move] = await segments();
    expect((await segments()).map((segment) => segment.kind)).toEqual(["stop", "move", "stop"]);
    if (move === undefined) throw new Error("no ride");
    const ridden = { from: at(move.from), to: at(move.to) };
    // A window in the middle of the ride, and its first and last points.
    const inside = { from: at(move.from + 301), to: at(move.from + 361) };
    const queued = await pointsIn(device.id, inside);
    const [firstPoint, lastPoint] = [
      await pointFromEnd(device.id, inside, queued),
      await pointFromEnd(device.id, inside, 1),
    ];
    const forward = await pointsIn(device.id, { from: at(move.from + 362), to: ridden.to });
    const grow = (maxPoints: number) =>
      extendWindow(t.ctx.db, device.id, inside, { gapSplitS: 1800, maxPoints });
    // With room: the whole ride.
    expect(await grow(budget)).toEqual(ridden);
    // Room for the rest of the ride after the window, not before it: forward first …
    expect(await grow(queued + forward + seamPoints)).toEqual({ from: firstPoint, to: ridden.to });
    // … and room for the window alone: the ride cut at its first and last point.
    expect(await grow(queued + seamPoints)).toEqual({ from: firstPoint, to: lastPoint });

    // Worked out so: the ride in three parts that meet, each counting its own.
    const config = t.ctx.processing.config;
    await enqueueWindow(t.ctx.db, { deviceId: device.id, ...inside, reason: "reprocess" });
    const rows = await takeDeviceWindows(t.ctx.db, device.id, inside.from, inside.to);
    const outcome = await processWindow(t.ctx.db, rows, {
      config: { ...config, passes: { ...config.passes, maxPoints: queued + seamPoints } },
      mapping: true,
      now: new Date(),
    });
    expect(outcome?.points).toBe(queued);
    const parts = (await segments()).filter((segment) => segment.kind === "move");
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[0]?.to).toBe(firstPoint.getTime() / 1000);
    expect(parts.at(-1)?.from).toBe(lastPoint.getTime() / 1000);
    expect(parts.reduce((sum, part) => sum + part.points, 0)).toBe(
      (await pointsIn(device.id, ridden)) + parts.length - 1,
    );
    await assertSegmentInvariants(t.ctx.db, device.id);
  });

  it("takes in a segment that starts after a short hole with no point in it", async () => {
    // Two hours at home, as an older pass left them: two stops, half a minute between them.
    const device = await newDevice("A day's edge");
    const start = morning - 225 * 86_400;
    const first = stay(home, { startT: start, durationS: 3600, intervalS: 30, seed: 81 });
    const second = stay(home, {
      startT: lastT(first) + 30,
      durationS: 3600,
      intervalS: 30,
      seed: 82,
    });
    await upload(device.token, concat(first, second));
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    for (const part of [first, second]) {
      await t.ctx.db.execute(sql`
        INSERT INTO segments (device_id, started_at, ended_at, kind, distance_m, duration_s,
          point_count, start_lat, start_lon, end_lat, end_lon, centroid_lat, centroid_lon, features,
          version)
        VALUES (${device.id}, to_timestamp(${part[0]?.t ?? 0}), to_timestamp(${lastT(part)}), 'stop', 0,
          3600, ${part.length}, 51, 3.7, 51, 3.7, 51, 3.7,
          ${JSON.stringify({ lastPointT: lastT(part) })}::jsonb, ${processingVersions.inferred})
      `);
    }
    const both = { from: at(first[0]?.t ?? 0), to: at(lastT(second)) };
    const between = at(lastT(first) + 15);
    const grow = (window: Range) =>
      extendWindow(t.ctx.db, device.id, window, { gapSplitS: 1800, maxPoints: budget });
    // A window up to the hole takes in the stop after it; one from the hole on starts there, as
    // after a pause of the phone (no recording gap to work out with both its ends).
    expect(await grow({ from: both.from, to: between })).toEqual(both);
    expect(await grow({ from: between, to: both.to })).toEqual({ from: between, to: both.to });
  });

  it("reaches back across a gap to the point before it, where it cannot take the stop it is in", async () => {
    // Two hours at home, two hours without a point, two more: one stop over the night.
    const device = await newDevice("A night it cannot take");
    const start = morning - 226 * 86_400;
    const evening = stay(home, { startT: start, durationS: 7200, intervalS: 10, seed: 83 });
    const dawn = stay(home, {
      startT: lastT(evening) + 7200,
      durationS: 7200,
      intervalS: 10,
      seed: 84,
    });
    await upload(device.token, concat(evening, dawn));
    await t.ctx.processing.flush();
    const stops = await t.ctx.db.execute(
      sql`SELECT kind FROM segments WHERE device_id = ${device.id}`,
    );
    expect(stops.rows).toEqual([{ kind: "stop" }]);
    // A window over the morning, with room for the morning and its seams only.
    const window = { from: at(dawn[0]?.t ?? 0), to: at(lastT(dawn)) };
    const room = (await pointsIn(device.id, window)) + seamPoints;
    expect(
      await extendWindow(t.ctx.db, device.id, window, { gapSplitS: 1800, maxPoints: room }),
    ).toEqual({ from: at(lastT(evening)), to: window.to });
  });
});

describe("the seams of a pass at its budget", () => {
  /** The pass runner of the default context, the budget and the segment invariants checked. */
  const runnerFor = (deviceId: string) =>
    new PassRunner({
      db: t.ctx.db,
      config: t.ctx.processing.config,
      mapping: false,
      after: async (pass) => {
        await expectWithinBudget(deviceId, pass);
        await assertSegmentInvariants(t.ctx.db, deviceId);
      },
    });
  /** As many points as a pass takes on at most, every four seconds at home. */
  const dawnAt = (startT: number, seed: number) =>
    stay(home, { startT, durationS: (budget - seamPoints - 1) * 4, intervalS: 4, seed });

  it("steps back across the gap of a split at the budget's very boundary", {
    timeout: 120_000,
  }, async () => {
    // Ten minutes in the evening, two hours without a point, then exactly what a pass takes on.
    const device = await newDevice("A night at the budget's edge");
    const start = morning - 270 * 86_400;
    const evening = stay(home, { startT: start, durationS: 600, intervalS: 10, seed: 91 });
    const dawn = dawnAt(lastT(evening) + 7200, 92);
    await upload(device.token, concat(evening, dawn));
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    await enqueueWindow(t.ctx.db, {
      deviceId: device.id,
      from: at(start),
      to: at(lastT(dawn)),
      reason: "delete",
    });
    const passes = await runnerFor(device.id).drain(5);
    // Split at the night, the newer part's pass with the evening's last point all the same …
    expect(passes.map((pass) => pass.outcome.split)).toEqual([true, false]);
    expect(passes[0]?.outcome.queued.from).toEqual(at(dawn[0]?.t ?? 0));
    expect(passes[0]?.outcome.from).toEqual(at(lastT(evening)));
    expect(passes[0]?.outcome.points).toBe(budget - seamPoints + 1);
    // … so the night is worked out with both its ends: a stop over it that meets the evening's.
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
  });

  it("takes an older part of one point into the newer pass", { timeout: 120_000 }, async () => {
    // One point, two hours without one, then exactly what a pass takes on.
    const device = await newDevice("One point before the night");
    const start = morning - 272 * 86_400;
    const lone = stay(home, { startT: start, durationS: 0, intervalS: 10, seed: 93 });
    const dawn = dawnAt(start + 7200, 94);
    await upload(device.token, concat(lone, dawn));
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    await enqueueWindow(t.ctx.db, {
      deviceId: device.id,
      from: at(start - 600),
      to: at(lastT(dawn)),
      reason: "delete",
    });
    const passes = await runnerFor(device.id).drain(5);
    expect(passes.map((pass) => [pass.outcome.split, pass.outcome.points])).toEqual([
      [false, budget - seamPoints + 1],
    ]);
    expect(passes[0]?.outcome.from).toEqual(at(start));
    const left = await t.ctx.db.execute(
      sql`SELECT 1 FROM processing_queue WHERE device_id = ${device.id}`,
    );
    expect(left.rows).toEqual([]);
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
  });

  it("steps forward to the first point after a day's edge, where the next day's stop begins", async () => {
    // Two hours at home, a point every ten seconds, none at the edge of the day between them.
    const device = await newDevice("A day's edge at the budget");
    const edge = morning - 274 * 86_400;
    const stayed = stay(home, { startT: edge - 3595, durationS: 7200, intervalS: 10, seed: 95 });
    await upload(device.token, stayed);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    const config = t.ctx.processing.config;
    const pass = async (range: Range, maxPoints: number) => {
      await enqueueWindow(t.ctx.db, { deviceId: device.id, ...range, reason: "reprocess" });
      const rows = await takeDeviceWindows(t.ctx.db, device.id, range.from, range.to);
      return processWindow(t.ctx.db, rows, {
        config: { ...config, passes: { ...config.passes, maxPoints } },
        mapping: false,
        now: new Date(),
      });
    };
    // The later day first, as the backfill goes; its stop begins at its first point.
    await pass({ from: at(edge), to: at(lastT(stayed)) }, budget);
    // The earlier day with room for its own points only: it cannot take the later stop in, …
    const earlier = { from: at(stayed[0]?.t ?? 0), to: at(edge) };
    const outcome = await pass(earlier, (await pointsIn(device.id, earlier)) + seamPoints);
    // … but steps to its first point, so the two stops meet there.
    expect(outcome?.to).toEqual(at(edge + 5));
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
  });
});

describe("a retried window", () => {
  it("is ready again to the millisecond, as every window", async () => {
    const device = await newDevice("Failed once");
    const range = { from: at(morning - 276 * 86_400), to: at(morning - 276 * 86_400 + 3600) };
    await enqueueWindow(t.ctx.db, { deviceId: device.id, ...range, reason: "delete" });
    const rows = await takeDeviceWindows(t.ctx.db, device.id, range.from, range.to);
    await retryWindows(t.ctx.db, rows, "failed for the test");
    const retried = await t.ctx.db.execute<{ attempts: number; later: boolean }>(sql`
      SELECT attempts, next_at > now() AS later FROM processing_queue WHERE device_id = ${device.id}
    `);
    expect(retried.rows).toEqual([{ attempts: 1, later: true }]);
    await assertQueueInvariants(t.ctx.db, { deviceId: device.id });
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
  });
});

describe("a device's live passes", () => {
  it("keep their interval: an upload after a pass waits until half a minute after it began", {
    timeout: 120_000,
  }, async () => {
    const device = await newDevice("Uploads every few seconds");
    const drive = motorwayDrive(morning - 230 * 86_400);
    await upload(device.token, drive.slice(0, 600));
    await t.ctx.processing.flush();
    const began = await t.ctx.db.execute<{ at: string }>(sql`
      SELECT date_trunc('milliseconds', processed_at)::text AS at FROM processed_points
      WHERE device_id = ${device.id} ORDER BY recorded_at DESC LIMIT 1
    `);
    await upload(device.token, drive.slice(600));
    const queued = await t.ctx.db.execute<{ next_at: string; ready: boolean }>(sql`
      SELECT next_at::text, next_at <= now() AS ready FROM processing_queue
      WHERE device_id = ${device.id}
    `);
    expect(queued.rows.map((row) => Date.parse(toIso(row.next_at)))).toEqual([
      Date.parse(toIso(began.rows[0]?.at ?? "")) + livePassIntervalMs,
    ]);
    expect(queued.rows.map((row) => row.ready)).toEqual([false]);
    // A flush does not wait for it.
    await t.ctx.processing.flush();
    const left = await t.ctx.db.execute(
      sql`SELECT 1 FROM processing_queue WHERE device_id = ${device.id} AND missing_tiles IS NULL`,
    );
    expect(left.rows).toEqual([]);
  });

  it("make the device's other live windows wait the interval after each of its passes, and nothing else", async () => {
    const device = await newDevice("Two uploads at once");
    const start = morning - 240 * 86_400;
    await upload(device.token, motorwayDrive(start));
    await upload(device.token, motorwayDrive(start + 6 * 3600));
    const deleted = { from: at(start + 12 * 3600), to: at(start + 13 * 3600) };
    await enqueueWindow(t.ctx.db, { deviceId: device.id, ...deleted, reason: "delete" });
    const nextAt = async (priority: number) =>
      (
        await t.ctx.db.execute<{ next_at: string }>(sql`
          SELECT next_at::text FROM processing_queue
          WHERE device_id = ${device.id} AND priority = ${priority} AND missing_tiles IS NULL
        `)
      ).rows.map((row) => Date.parse(toIso(row.next_at)));
    const [repairBefore] = await nextAt(queuePriority.repair);
    // The first drive's uploads (batches of a thousand points), not the second's.
    const rows = await takeDeviceWindows(t.ctx.db, device.id, at(start - 3600), at(start + 3600));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.priority === queuePriority.live)).toBe(true);
    expect(rows.every((row) => row.to < at(start + 3 * 3600))).toBe(true);
    const started = Date.now();
    await processWindow(t.ctx.db, rows, {
      config: t.ctx.processing.config,
      mapping: true,
      now: new Date(),
    });
    const ended = Date.now();
    const [later] = await nextAt(queuePriority.live);
    expect(later).toBeGreaterThanOrEqual(started + livePassIntervalMs);
    expect(later).toBeLessThanOrEqual(ended + livePassIntervalMs);
    expect(await nextAt(queuePriority.repair)).toEqual([repairBefore]);
    // A pass of other work of the device ends: its live windows wait again, from that end.
    const repair = await takeDeviceWindows(t.ctx.db, device.id, deleted.from, deleted.to);
    expect(repair.map((row) => row.reason)).toEqual(["delete"]);
    const repairStarted = Date.now();
    await processWindow(t.ctx.db, repair, {
      config: t.ctx.processing.config,
      mapping: true,
      now: new Date(),
    });
    const repairEnded = Date.now();
    for (const next of await nextAt(queuePriority.live)) {
      expect(next).toBeGreaterThanOrEqual(repairStarted + livePassIntervalMs);
      expect(next).toBeLessThanOrEqual(repairEnded + livePassIntervalMs);
    }
    await t.ctx.processing.flush();
  });
});

describe("the order of the work", () => {
  it("is live, repair, backfill; after live work the others take their turn", async () => {
    // Only this test's windows in the queue.
    await t.ctx.db.execute(sql`DELETE FROM processing_queue`);
    const devices = {
      backfill: await newDevice("Backfill only"),
      repair: await newDevice("Repair only"),
      live: await newDevice("Live only"),
    };
    const from = at(morning - 250 * 86_400);
    const to = at(morning - 250 * 86_400 + 3600);
    await enqueueWindow(t.ctx.db, { deviceId: devices.backfill.id, from, to, reason: "backfill" });
    await enqueueWindow(t.ctx.db, { deviceId: devices.repair.id, from, to, reason: "split" });
    await enqueueWindow(t.ctx.db, { deviceId: devices.live.id, from, to, reason: "ingest" });
    const order = async (othersFirst: boolean) => {
      const taken: number[] = [];
      const seen = new Set<string>();
      for (;;) {
        const rows = await takeNextWindow(t.ctx.db, new Date(), { othersFirst });
        const [row] = rows;
        if (row === undefined || seen.has(row.deviceId)) break;
        seen.add(row.deviceId);
        taken.push(row.priority);
        // Out of the way until the next round.
        await t.ctx.db.execute(sql`
          UPDATE processing_queue SET next_at = next_at + interval '1 day' WHERE device_id = ${row.deviceId}
        `);
      }
      await t.ctx.db.execute(
        sql`UPDATE processing_queue SET next_at = now() - interval '1 second'`,
      );
      return taken;
    };
    expect(await order(false)).toEqual([
      queuePriority.live,
      queuePriority.repair,
      queuePriority.backfill,
    ]);
    // The others' turn: repair before the backfill, so a correction never waits for a whole run.
    expect(await order(true)).toEqual([
      queuePriority.repair,
      queuePriority.backfill,
      queuePriority.live,
    ]);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue`);
  });
});

/** What an older inference left of a stay: its points as they came, one stop over all of them. */
function oneStop(points: readonly RawPoint[]): WindowResult {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) throw new Error("no points");
  const place = { lat: first.lat, lon: first.lon };
  return {
    averaged: points.map((point) => ({
      t: point.t,
      kept: true,
      lat: point.lat,
      lon: point.lon,
      speed: 0,
      stationary: true,
      accuracy: point.accuracy ?? 10,
    })),
    mapped: points.map(() => null),
    segments: [
      {
        kind: "stop",
        startT: first.t,
        endT: last.t,
        first: 0,
        last: points.length - 1,
        distanceM: 0,
        pointCount: points.length,
        start: place,
        end: place,
        centroid: place,
        modeInferred: null,
        modeUser: null,
        confidence: null,
        averageSpeedMs: null,
        maxSpeedMs: null,
        features: { spreadM: 10 },
      },
    ],
    missingTiles: [],
  };
}

describe("twenty live uploads after a stale multi-day stop", () => {
  it("are each worked out in a pass within the budget while the backfill runs", {
    timeout: 900_000,
  }, async () => {
    const device = await newDevice("Three days at one place");
    const config = t.ctx.processing.config;
    const start = morning - 100 * 86_400;
    // 1. A commute, then three days at its end at a point every four seconds (65 000 points) …
    const commute = motorwayDrive(start);
    await upload(device.token, commute);
    await t.ctx.processing.flush();
    const arrived = commute.at(-1);
    if (arrived === undefined) throw new Error("no commute");
    const place = toXY(arrived);
    const days = stay(place, {
      startT: arrived.t + 4,
      durationS: 3 * 86_400,
      intervalS: 4,
      seed: 61,
    });
    expect(days.length).toBeGreaterThan(64_000);
    await upload(device.token, days);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    // … as the inference before this one left them: one stop from the commute's end, through
    // persistWindow with the old versions, and the commute of that version too.
    const older = { ...processingVersions, inferred: processingVersions.inferred - 1 };
    const stale = [arrived, ...days];
    await t.ctx.db.transaction((tx) =>
      persistWindow(tx, {
        deviceId: device.id,
        from: at(arrived.t),
        to: at(lastT(days)),
        raw: stale,
        result: oneStop(stale),
        versions: older,
        config,
      }),
    );
    await t.ctx.db.execute(
      sql`UPDATE segments SET version = ${older.inferred} WHERE device_id = ${device.id}`,
    );
    await t.ctx.dailyStats.flush();
    await t.ctx.db.execute(sql`
      INSERT INTO processing_state (key, value) VALUES ('backfill', ${JSON.stringify({ versions: older })}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `);
    expect((await enqueueBackfill(t.ctx.db, processingVersions)).fromLevel).toBe("inferred");
    // The other tests' devices are not this backfill's.
    await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id <> ${device.id}`);
    const stalePoints = async () =>
      (
        await t.ctx.db.execute<{ points: number }>(sql`
          SELECT coalesce(sum(point_count), 0)::int AS points FROM segments
          WHERE device_id = ${device.id} AND version < ${processingVersions.inferred}
        `)
      ).rows[0]?.points ?? 0;
    expect(await stalePoints()).toBeGreaterThan(65_000);

    // 2. East of the stay the map tiles cannot be fetched, whatever was cached before.
    const ride = travel([place, [place[0] + 20_000, place[1]]], {
      startT: lastT(days) + 2,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 62,
    });
    for (const tile of planWindow(ride, [], config).tiles) {
      fixture.failing.add(tile);
      const address = parseTileKey(tile);
      if (address !== null) {
        await t.ctx.db.execute(sql`
          DELETE FROM osm_tiles WHERE z = ${address.z} AND x = ${address.x} AND y = ${address.y}
        `);
      }
    }

    // 3. Twenty uploads three minutes apart, each worked out as the worker does: its pass first,
    // then the backfill's turn — and after every pass the invariants.
    const uploads: Range[] = [];
    const runner: PassRunner = new PassRunner({
      db: t.ctx.db,
      config,
      mapping: true,
      after: async (pass) => {
        await expectWithinBudget(device.id, pass);
        await assertSegmentInvariants(t.ctx.db, device.id, { finished: runner.log.map(windowOf) });
        await assertQueueInvariants(t.ctx.db, { deviceId: device.id, uploads });
      },
    });
    const remaining = [await stalePoints()];
    const riding = ride[0]?.t ?? 0;
    let lastLive: Pass | null = null;
    try {
      for (let index = 0; index < 20; index += 1) {
        const batch = ride.filter(
          (point) => point.t >= riding + index * 180 && point.t < riding + (index + 1) * 180,
        );
        await upload(device.token, batch);
        const queued = queuedFor(batch);
        uploads.push(queued);
        const live = await runner.next();
        if (live === null) throw new Error("the upload was not worked out");
        // The upload alone, with the bounds it was queued with: never grown, never earlier.
        expect(live.rows.map((row) => [row.priority, row.from, row.to])).toEqual([
          [queuePriority.live, queued.from, queued.to],
        ]);
        expect(live.outcome.queued).toEqual(queued);
        lastLive = live;
        // Then the others' turn: the correction the person made after the first upload at once,
        // before the backfill that runs meanwhile; else the backfill, while there is backfill.
        const turn = await runner.next((rows) =>
          rows.every((row) => row.priority !== queuePriority.live),
        );
        if (index === 1) {
          expect(turn?.rows.map((row) => row.reason)).toContain("override");
        } else if (turn !== null) {
          expect(turn.rows.map((row) => row.priority)).toContain(queuePriority.backfill);
        }
        remaining.push(await stalePoints());
        if (index === 0) {
          // The commute's mode put right and reset: its span is queued for the inference, repair.
          const commuted = await t.ctx.db.execute<{ id: string }>(sql`
            SELECT id FROM segments WHERE device_id = ${device.id} AND kind = 'move'
            ORDER BY started_at LIMIT 1
          `);
          const move = commuted.rows[0]?.id ?? "";
          await owner
            .put(apiPaths.v1.segments.mode(move))
            .set("Origin", testOrigin)
            .send({ mode: "train" })
            .expect(200);
          await owner.delete(apiPaths.v1.segments.mode(move)).set("Origin", testOrigin).expect(200);
          const queued = await t.ctx.db.execute<{ priority: number }>(sql`
            SELECT priority FROM processing_queue WHERE device_id = ${device.id} AND reason = 'override'
          `);
          expect(queued.rows).toEqual([{ priority: queuePriority.repair }]);
        }
      }
    } finally {
      fixture.failing.clear();
    }
    // The backfill went on through the uploads: less of the older inference after each, until none.
    const done = remaining.indexOf(0);
    const progress = `old points left after each upload: ${remaining.join(", ")}\n${passLog(runner.log)}`;
    expect(done, progress).toBeGreaterThan(0);
    for (let index = 1; index <= done; index += 1) {
      expect(remaining[index], `after upload ${index}: ${progress}`).toBeLessThan(
        remaining[index - 1] ?? 0,
      );
    }
    // I6 on the last upload's pass, and nothing of the older inference anywhere once all is done.
    if (lastLive !== null) {
      const pass = lastLive;
      await assertIdempotent(t.ctx.db, device.id, windowOf(pass), () => runAgain(device.id, pass));
    }
    await runner.drain();
    await assertSegmentInvariants(t.ctx.db, device.id, {
      current: true,
      finished: runner.log.map(windowOf),
    });
    // What waits now waits for the ride's map tiles, with the bounds its upload queued.
    await assertQueueInvariants(t.ctx.db, { deviceId: device.id, uploads });
    const pending = await t.ctx.db.execute<{ waiting: boolean }>(sql`
      SELECT missing_tiles IS NOT NULL AS waiting FROM processing_queue WHERE device_id = ${device.id}
    `);
    expect(pending.rows.every((row) => row.waiting)).toBe(true);
  });
});
