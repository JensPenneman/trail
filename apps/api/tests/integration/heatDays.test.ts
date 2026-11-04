import { apiPaths } from "@trail/contracts/apiPaths";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillHeatDayLevels } from "../../src/heatmap/fillHeatDayLevels";
import { findDayCells } from "../../src/heatmap/findDayCells";
import { heatDaysValidator } from "../../src/heatmap/heatDaysValidator";
import { heatCellsRebuilt, heatGeneration } from "../../src/heatmap/heatGeneration";
import { rebuildHeatDays } from "../../src/heatmap/rebuildHeatDays";
import { latToTileY, lonToTileX } from "../../src/heatmap/tileMath";
import { deleteLocationRange } from "../../src/locations/deleteLocationRange";
import { runFeatureBackfill } from "../../src/processing/featureBackfill";
import { rebuildDailyStats } from "../../src/stats/rebuildDailyStats";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { from } from "../support/sharingFlows";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * heat_days (docs/architecture.md §5, §8.2): the per-day cells of time on the move, written from
 * the processed points and the segments, and read for the heatmap. Points and segments are
 * written by hand so that every number is known.
 */
let t: TestContext;
let owner: Agent;
let device = "";
const logger = pino({ level: "silent" });

/** Two recent days: the levels are compared over the last 90 days. */
const day1 = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const day2 = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const instant = (day: string, time: string) => `${day}T${time}Z`;
const zone = "UTC";

async function point(at: string, lat: number, lon: number, speed: number | null) {
  await t.ctx.db.execute(sql`
    INSERT INTO locations (device_id, recorded_at, lat, lon) VALUES (${device}::uuid, ${at}::timestamptz, ${lat}, ${lon})
  `);
  await t.ctx.db.execute(sql`
    INSERT INTO processed_points (device_id, recorded_at, kept, lat_avg, lon_avg, speed_avg, version)
    VALUES (${device}::uuid, ${at}::timestamptz, true, ${lat}, ${lon}, ${speed}, 1)
  `);
}

async function segment(kind: "stop" | "move", from: string, to: string, mode: string | null) {
  const seconds = (Date.parse(to) - Date.parse(from)) / 1000;
  const { rows } = await t.ctx.db.execute<{ id: string }>(sql`
    INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, confidence,
      distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
      centroid_lat, centroid_lon, features, version)
    VALUES (${device}::uuid, ${from}::timestamptz, ${to}::timestamptz, ${kind}, ${mode}, ${mode},
      0.9, 100, ${seconds}, 5, 10, 51, 3.7, 51, 3.71, 51, 3.705, '{}'::jsonb, 3)
    RETURNING id
  `);
  return rows[0]?.id ?? "";
}

interface Totals {
  points: number;
  move_s: number;
  speed_s: number;
  distance_m: number;
  max_speed: number | null;
}

/** A level's rows summed by mode, for one day or all. */
async function totals(z: number, day?: string): Promise<Record<string, Totals>> {
  const { rows } = await t.ctx.db.execute<Totals & { mode: string } & Record<string, unknown>>(sql`
    SELECT mode, sum(points)::int AS points, sum(move_s)::int AS move_s, sum(speed_s)::float8 AS speed_s,
      sum(distance_m)::float8 AS distance_m, max(max_speed)::float8 AS max_speed
    FROM heat_days WHERE device_id = ${device}::uuid AND z = ${z}
      ${day === undefined ? sql`` : sql`AND day = ${day}::date`}
    GROUP BY mode
  `);
  return Object.fromEntries(rows.map((row) => [row.mode, row]));
}

const rebuild = (days: readonly string[] | "all", tz = zone) =>
  t.ctx.db.transaction((tx) => rebuildHeatDays(tx, device, tz, days));

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({});
  ({ agent: owner } = await signUpWithCookie(t.app, "first@example.com"));
  await t.ctx.db.execute(
    sql`UPDATE users SET timezone = ${zone} WHERE email = 'first@example.com'`,
  );
  device = (await createDevice(owner, { name: "Rider" })).device.id;

  // Day 1: a ride of eleven points a minute apart east along 51°N, then a gap of 700 s (more than
  // the 600 s that count) to a stay of six points, then one point outside any segment.
  for (let i = 0; i <= 10; i += 1) {
    await point(instant(day1, `10:${String(i).padStart(2, "0")}:00`), 51, 3.7 + i * 0.001, 5);
  }
  await segment("move", instant(day1, "10:00:00"), instant(day1, "10:10:00"), "cycling");
  for (let i = 0; i <= 5; i += 1) {
    await point(instant(day1, `10:2${i + 1}:40`), 51, 3.72, 0.1);
  }
  await segment("stop", instant(day1, "10:21:40"), instant(day1, "10:26:40"), null);
  await point(instant(day1, "12:00:00"), 51, 3.73, null);
  // A drive across midnight: 23:58 to 00:02, five points a minute apart at 10 m/s.
  for (const [i, time] of ["23:58:00", "23:59:00"].entries()) {
    await point(instant(day1, time), 51.02, 3.7 + i * 0.002, 10);
  }
  for (const [i, time] of ["00:00:00", "00:01:00", "00:02:00"].entries()) {
    await point(instant(day2, time), 51.02, 3.704 + i * 0.002, 10);
  }
  await segment("move", instant(day1, "23:58:00"), instant(day2, "00:02:00"), "car");
  await t.ctx.db.transaction((tx) => rebuildDailyStats(tx, device, zone));
});

afterAll(async () => {
  await t.close();
});

describe("what a pass writes", () => {
  it("makes the days' cells at three levels from the points, the gaps and the modes", async () => {
    await rebuild("all");
    for (const z of [12, 15, 18]) {
      const day = await totals(z, day1);
      // Eleven points of the ride, ten minutes of it (the 700 s to the stay count for nothing).
      expect(day["cycling"], `z${z}`).toMatchObject({
        points: 11,
        move_s: 600,
        speed_s: 3000,
        max_speed: 5,
      });
      expect(day["cycling"]?.distance_m).toBeGreaterThan(690);
      expect(day["cycling"]?.distance_m).toBeLessThan(710);
      // The stay's six points, nothing on the move; the lone point outside any segment is unknown.
      expect(day["stationary"], `z${z}`).toMatchObject({ points: 6, move_s: 0, speed_s: 0 });
      expect(day["unknown"], `z${z}`).toMatchObject({ points: 1, move_s: 0 });
      // The drive: two points and two minutes on day 1 (an interval belongs to its first point), ...
      expect(day["car"], `z${z}`).toMatchObject({ points: 2, move_s: 120, max_speed: 10 });
      // ... three points and two minutes on day 2.
      expect((await totals(z, day2))["car"], `z${z}`).toMatchObject({ points: 3, move_s: 120 });
    }
  });

  it("is the same when made again, and a day's rebuild touches that day only", async () => {
    const before = await totals(18);
    const stamp = async (day: string) =>
      (
        await t.ctx.db.execute<{ at: string }>(sql`
          SELECT max(computed_at)::text AS at FROM heat_days WHERE device_id = ${device}::uuid AND day = ${day}::date
        `)
      ).rows[0]?.at;
    const firstDay = await stamp(day1);
    await rebuild([day2]);
    expect(await totals(18)).toEqual(before);
    expect(await stamp(day1)).toBe(firstDay);
    await rebuild([new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10)]);
    expect(await totals(18)).toEqual(before);
  });

  it("moves a move's rows to another mode when its mode is corrected, and back when reset", async () => {
    const { rows } = await t.ctx.db.execute<{ id: string }>(sql`
      SELECT id FROM segments WHERE device_id = ${device}::uuid AND mode = 'cycling'
    `);
    const id = rows[0]?.id ?? "";
    await owner
      .put(apiPaths.v1.segments.mode(id))
      .set("Origin", testOrigin)
      .send({ mode: "walking" })
      .expect(200);
    const corrected = await totals(18, day1);
    expect(corrected["cycling"]).toBeUndefined();
    expect(corrected["walking"]).toMatchObject({ points: 11, move_s: 600 });
    await owner.delete(apiPaths.v1.segments.mode(id)).set("Origin", testOrigin).expect(200);
    const reset = await totals(18, day1);
    expect(reset["walking"]).toBeUndefined();
    expect(reset["cycling"]).toMatchObject({ points: 11, move_s: 600 });
  });

  it("is cut in the days of a new time zone", async () => {
    // Auckland is UTC+13 in October: the drive of 23:58–00:02 UTC is 12:58–13:02 on the 21st.
    await from(owner, "patch", apiPaths.me.root, { timezone: "Pacific/Auckland" }).expect(200);
    await t.ctx.background.drain(5000);
    const days = await t.ctx.db.execute<{ day: string; points: number }>(sql`
      SELECT day::text AS day, sum(points)::int AS points FROM heat_days
      WHERE device_id = ${device}::uuid AND z = 12 AND mode = 'car' GROUP BY day ORDER BY day
    `);
    expect(days.rows).toEqual([{ day: day2, points: 5 }]);
    await from(owner, "patch", apiPaths.me.root, { timezone: zone }).expect(200);
    await t.ctx.background.drain(5000);
    expect((await totals(12, day2))["car"]).toMatchObject({ points: 3 });
  });
});

describe("what is read", () => {
  const bbox = [3.6, 50.9, 3.9, 51.2] as const;
  const read = (
    heat: "moving" | "speed" | "topspeed",
    cellZoom: number,
    mode: "cycling" | "car" | null = null,
  ) =>
    findDayCells(t.ctx.db, {
      deviceIds: [device],
      heat,
      mode,
      bbox,
      cellZoom,
      from: day1,
      to: day2,
      limit: 1000,
    });
  const sum = (cells: readonly (readonly [number, number, number])[]) =>
    cells.reduce((all, cell) => all + cell[2], 0);

  it("sums the seconds on the move, of one mode or every one, whatever the zoom", async () => {
    // 600 s of cycling and 120 + 120 s of driving.
    for (const cellZoom of [18, 15, 12, 9, 6]) {
      expect(sum((await read("moving", cellZoom)).cells), `z${cellZoom}`).toBe(840);
      expect(sum((await read("moving", cellZoom, "car")).cells), `z${cellZoom}`).toBe(240);
      expect(sum((await read("moving", cellZoom, "cycling")).cells), `z${cellZoom}`).toBe(600);
    }
    // Finer than 18 is answered at 18.
    const fine = await read("moving", 20);
    expect(fine.cellZoom).toBe(18);
    expect(sum(fine.cells)).toBe(840);
    // The cells are the tiles of the level they are answered at.
    const [lon, lat] = [3.7, 51];
    expect(
      (await read("moving", 18, "cycling")).cells.some(
        ([x, y]) => x === lonToTileX(lon, 18) && y === latToTileY(lat, 18),
      ),
    ).toBe(true);
  });

  it("tells the average and the top speed in cm/s, the speed from ten seconds of movement", async () => {
    const speed = await read("speed", 18, "car");
    expect(speed.cells.length).toBeGreaterThan(0);
    expect(speed.cells.every((cell) => cell[2] === 1000)).toBe(true);
    // The top speed of each cell at zoom 12: the drive's 10 m/s and the ride's 5 m/s.
    const top = await read("topspeed", 12);
    expect(top.cells).toEqual([
      [lonToTileX(3.7, 12), latToTileY(51.02, 12), 1000],
      [lonToTileX(3.7, 12), latToTileY(51, 12), 500],
    ]);
    // The ride's 5 m/s for every cell it crossed, a stay and a lone point having none.
    const riding = await read("speed", 18, "cycling");
    expect(riding.cells.length).toBeGreaterThan(0);
    expect(riding.cells.every((cell) => cell[2] === 500)).toBe(true);
    // Under ten seconds on the move in a cell tells no speed.
    expect((await read("speed", 18, "plane" as never)).cells).toEqual([]);
  });

  it("answers over HTTP with the mode and the period echoed, and moves its ETag with the cells", async () => {
    const url = `${apiPaths.heatmap}?bbox=3.6,50.9,3.9,51.2&zoom=13&heat=moving&mode=car&from=${day1}&to=${day2}`;
    // The mode corrections above queued windows for the inference: not what this is about.
    await t.ctx.db.execute(sql`DELETE FROM processing_queue`);
    const first = await owner.get(url).expect(200);
    const answer = heatmapResponseSchema.parse(first.body);
    expect(answer).toMatchObject({
      heat: "moving",
      mode: "car",
      cellZoom: 18,
      pending: false,
      period: { from: day1, to: day2 },
    });
    expect(sum(answer.cells)).toBe(240);
    const etag = String(first.headers["etag"]);
    await owner.get(url).set("If-None-Match", etag).expect(304);
    await rebuild([day1]);
    // The rows were made again: their time stamp is new, so is the answer.
    await owner.get(url).set("If-None-Match", etag).expect(200);
    // A mode needs a measure of movement.
    await owner
      .get(`${apiPaths.heatmap}?bbox=3.6,50.9,3.9,51.2&zoom=13&heat=time&mode=car`)
      .expect(400);
  });

  it("flags days that have points and no cells yet as pending", async () => {
    await t.ctx.db.execute(
      sql`DELETE FROM heat_days WHERE device_id = ${device}::uuid AND day = ${day2}::date`,
    );
    const url = `${apiPaths.heatmap}?bbox=3.6,50.9,3.9,51.2&zoom=13&heat=moving&from=${day1}&to=${day2}`;
    expect(heatmapResponseSchema.parse((await owner.get(url).expect(200)).body).pending).toBe(true);
    await rebuild([day2]);
    expect(heatmapResponseSchema.parse((await owner.get(url).expect(200)).body).pending).toBe(
      false,
    );
  });

  it("changes its validator with the rows of the period", async () => {
    const before = await heatDaysValidator(t.ctx.db, [device], { from: day1, to: day2 });
    await rebuild([day1]);
    const after = await heatDaysValidator(t.ctx.db, [device], { from: day1, to: day2 });
    expect(after).not.toEqual(before);
    expect(await heatDaysValidator(t.ctx.db, [device], { from: day1, to: day2 })).toEqual(after);
  });
});

describe("what the start-up restores", () => {
  it("fills days that have points and no cells, newest first, once", async () => {
    const want = await totals(18);
    await t.ctx.db.execute(sql`DELETE FROM heat_days WHERE device_id = ${device}::uuid`);
    await t.ctx.db.execute(sql`DELETE FROM processing_state WHERE key = 'features'`);
    const order: string[] = [];
    const run = await runFeatureBackfill(t.ctx.db, {
      pauseMs: 0,
      onDay: ({ deviceId }) => order.push(deviceId),
    });
    expect(run.features).toContain("heatDays");
    expect(run.complete).toBe(true);
    expect(await totals(18)).toEqual(want);
    const state = await t.ctx.db.execute<{ value: { versions: Record<string, number> } }>(
      sql`SELECT value FROM processing_state WHERE key = 'features'`,
    );
    expect(state.rows[0]?.value.versions["heatDays"]).toBe(1);
    expect((await runFeatureBackfill(t.ctx.db, { pauseMs: 0 })).features).not.toContain("heatDays");
    // Newest day first.
    const newest = await t.ctx.db.execute<{ day: string }>(sql`
      SELECT DISTINCT day::text AS day FROM heat_days WHERE device_id = ${device}::uuid ORDER BY day DESC
    `);
    expect(newest.rows.map((row) => row.day)).toEqual([day2, day1]);
  });

  it("rebuilds a level that misses cells and moves the generation", async () => {
    const want = await totals(15);
    await t.ctx.db.execute(sql`DELETE FROM heat_days WHERE device_id = ${device}::uuid AND z = 15`);
    heatCellsRebuilt();
    const before = heatGeneration();
    const filled = await fillHeatDayLevels(t.ctx.db, logger);
    expect(filled).toEqual({ devices: 1, complete: true });
    expect(await totals(15)).toEqual(want);
    expect(heatGeneration()).toBeGreaterThan(before);
    // Nothing to do when the levels agree.
    expect(await fillHeatDayLevels(t.ctx.db, logger)).toEqual({ devices: 0, complete: true });
  });
});

describe("what is left out of a day", () => {
  it("counts a move without a mode as unknown and does not stop on it", async () => {
    const other = (await createDevice(owner, { name: "Legacy" })).device.id;
    const at = instant(day1, "06:00:00");
    for (const [i, time] of ["06:00:00", "06:01:00"].entries()) {
      await t.ctx.db.execute(sql`
        INSERT INTO locations (device_id, recorded_at, lat, lon)
        VALUES (${other}::uuid, ${instant(day1, time)}::timestamptz, 50.5, ${4 + i * 0.001})`);
      await t.ctx.db.execute(sql`
        INSERT INTO processed_points (device_id, recorded_at, kept, lat_avg, lon_avg, speed_avg, version)
        VALUES (${other}::uuid, ${instant(day1, time)}::timestamptz, true, 50.5, ${4 + i * 0.001}, 3, 1)`);
    }
    await t.ctx.db.execute(sql`
      INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, confidence,
        distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
        centroid_lat, centroid_lon, features, version)
      VALUES (${other}::uuid, ${at}::timestamptz, ${instant(day1, "06:01:00")}::timestamptz, 'move',
        NULL, NULL, NULL, 70, 60, 3, 2, 50.5, 4, 50.5, 4.001, 50.5, 4.0005, '{}'::jsonb, 3)`);
    await t.ctx.db.transaction((tx) => rebuildHeatDays(tx, other, zone, [day1]));
    const { rows } = await t.ctx.db.execute<{ mode: string; move_s: number }>(sql`
      SELECT mode, sum(move_s)::int AS move_s FROM heat_days
      WHERE device_id = ${other}::uuid AND z = 12 GROUP BY mode`);
    expect(rows).toEqual([{ mode: "unknown", move_s: 60 }]);
  });

  it("is not pending, and not made again, for a day of points that were all dropped", async () => {
    const dim = (await createDevice(owner, { name: "Dim" })).device.id;
    for (const time of ["09:00:00", "09:01:00"]) {
      await t.ctx.db.execute(sql`
        INSERT INTO locations (device_id, recorded_at, lat, lon, horizontal_accuracy)
        VALUES (${dim}::uuid, ${instant(day1, time)}::timestamptz, 50.2, 4.2, 900)`);
      await t.ctx.db.execute(sql`
        INSERT INTO processed_points (device_id, recorded_at, kept, lat_avg, lon_avg, version)
        VALUES (${dim}::uuid, ${instant(day1, time)}::timestamptz, false, 50.2, 4.2, 1)`);
    }
    await t.ctx.db.transaction((tx) => rebuildDailyStats(tx, dim, zone));
    const days = await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM daily_stats WHERE device_id = ${dim}::uuid AND points > 0`,
    );
    expect(days.rows[0]?.n).toBe(1);
    const url = `${apiPaths.heatmap}?bbox=3.6,50.0,4.5,51.2&zoom=10&heat=moving&deviceIds=${dim}&from=${day1}&to=${day2}`;
    expect(heatmapResponseSchema.parse((await owner.get(url).expect(200)).body).pending).toBe(
      false,
    );
    await t.ctx.db.execute(sql`DELETE FROM processing_state WHERE key = 'features'`);
    const run = await runFeatureBackfill(t.ctx.db, { pauseMs: 0 });
    expect(run.features).toContain("heatDays");
    const rows = await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM heat_days WHERE device_id = ${dim}::uuid`,
    );
    expect(rows.rows[0]?.n).toBe(0);
    // Nothing lacks any more, so a start does not look again.
    expect((await runFeatureBackfill(t.ctx.db, { pauseMs: 0 })).features).not.toContain("heatDays");
  });
});

describe("the level check", () => {
  it("compares a device over its own newest days, however long ago they were", async () => {
    const idle = (await createDevice(owner, { name: "Idle" })).device.id;
    for (const [i, at] of ["2025-02-03T10:00:00Z", "2025-02-03T10:01:00Z"].entries()) {
      await t.ctx.db.execute(sql`
        INSERT INTO locations (device_id, recorded_at, lat, lon)
        VALUES (${idle}::uuid, ${at}::timestamptz, 50.3, ${4.1 + i * 0.001})`);
      await t.ctx.db.execute(sql`
        INSERT INTO processed_points (device_id, recorded_at, kept, lat_avg, lon_avg, version)
        VALUES (${idle}::uuid, ${at}::timestamptz, true, 50.3, ${4.1 + i * 0.001}, 1)`);
    }
    await t.ctx.db.transaction((tx) => rebuildHeatDays(tx, idle, zone, "all"));
    const levels = async () =>
      (
        await t.ctx.db.execute<{ z: number }>(
          sql`SELECT DISTINCT z FROM heat_days WHERE device_id = ${idle}::uuid ORDER BY z`,
        )
      ).rows.map((row) => row.z);
    expect(await levels()).toEqual([12, 15, 18]);
    // Nothing in the calendar's last 90 days, and a level gone: still found.
    await t.ctx.db.execute(sql`DELETE FROM heat_days WHERE device_id = ${idle}::uuid AND z = 15`);
    const filled = await fillHeatDayLevels(t.ctx.db, logger);
    expect(filled.complete).toBe(true);
    expect(filled.devices).toBeGreaterThanOrEqual(1);
    expect(await levels()).toEqual([12, 15, 18]);
  });
});

describe("days of 23 and 25 hours", () => {
  const brussels = "Europe/Brussels";
  const day = async (deviceId: string, date: string) =>
    (
      await t.ctx.db.execute<{ points: number }>(sql`
        SELECT coalesce(sum(points), 0)::int AS points FROM heat_days
        WHERE device_id = ${deviceId}::uuid AND z = 12 AND day = ${date}::date`)
    ).rows[0]?.points ?? 0;

  it("cuts a day where summer time ends, 25 hours, and where it begins, 23 hours", async () => {
    const dst = (await createDevice(owner, { name: "Clock" })).device.id;
    // 25 October 2026: the 25th runs from 22:00Z on the 24th to 23:00Z on the 25th.
    // 29 March 2026: the 29th runs from 23:00Z on the 28th to 22:00Z on the 29th.
    const times = [
      "2026-10-24T21:59:00Z",
      "2026-10-24T22:00:00Z",
      "2026-10-25T00:30:00Z",
      "2026-10-25T22:59:00Z",
      "2026-10-25T23:00:00Z",
      "2026-03-28T22:59:00Z",
      "2026-03-28T23:00:00Z",
      "2026-03-29T21:59:00Z",
      "2026-03-29T22:00:00Z",
    ];
    for (const [i, at] of times.entries()) {
      await t.ctx.db.execute(sql`
        INSERT INTO locations (device_id, recorded_at, lat, lon)
        VALUES (${dst}::uuid, ${at}::timestamptz, 50.1, ${4 + i * 0.01})`);
      await t.ctx.db.execute(sql`
        INSERT INTO processed_points (device_id, recorded_at, kept, lat_avg, lon_avg, version)
        VALUES (${dst}::uuid, ${at}::timestamptz, true, 50.1, ${4 + i * 0.01}, 1)`);
    }
    await t.ctx.db.transaction((tx) => rebuildHeatDays(tx, dst, brussels, "all"));
    // The edges just inside the day are the day's, the ones just outside the neighbours'.
    expect(await day(dst, "2026-10-24")).toBe(1);
    expect(await day(dst, "2026-10-25")).toBe(3);
    expect(await day(dst, "2026-10-26")).toBe(1);
    expect(await day(dst, "2026-03-28")).toBe(1);
    expect(await day(dst, "2026-03-29")).toBe(2);
    expect(await day(dst, "2026-03-30")).toBe(1);
  });
});

describe("what a deletion leaves", () => {
  it("rebuilds the days of the deleted range", async () => {
    const before = await totals(18, day1);
    const result = await deleteLocationRange(t.ctx.db, {
      deviceId: device,
      timezone: zone,
      from: new Date(instant(day1, "10:21:00")),
      to: new Date(instant(day1, "10:30:00")),
      queueProcessing: false,
    });
    expect(result.deleted).toBeGreaterThan(0);
    const after = await totals(18, day1);
    // The stay's points are gone (and its segment with them); the ride is untouched.
    expect(after["stationary"]).toBeUndefined();
    expect(after["cycling"]).toEqual(before["cycling"]);
    expect(after["unknown"]?.points).toBe(1);
  });
});
