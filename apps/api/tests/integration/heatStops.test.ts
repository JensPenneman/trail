import { apiPaths } from "@trail/contracts/apiPaths";
import { apiErrorSchema } from "@trail/contracts/errors";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findStopCells } from "../../src/heatmap/findStopCells";
import { heatCellsUpsert } from "../../src/heatmap/heatCellsUpsert";
import { latToTileY, lonToTileX } from "../../src/heatmap/tileMath";
import { tileXSql, tileYSql } from "../../src/heatmap/tileSql";
import { type Agent, agentFor, signUp, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * Heat by time spent and by visits (docs/architecture.md §8.2): stays merged per cell, clipped to
 * the period, as `[x, y, value]` tiles of the cell zoom; the cap, the antimeridian, the ETag and
 * who may ask. Stops are written by hand.
 */
let t: TestContext;
let owner: Agent;
let phone = "";
let tracker = "";
let foreign = "";

const home = { lat: 51.0362, lon: 3.7104 };
const office = { lat: 51.0562, lon: 3.7304 };
const far = { lat: 51.2, lon: 3.9 };
const period = { from: "2026-10-21", to: "2026-10-25" };
const around = { bbox: "3.5,50.9,4,51.3" };
const query = (values: Record<string, string | number>) =>
  new URLSearchParams(
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
  ).toString();

async function stop(
  deviceId: string,
  from: string,
  to: string,
  at: { lat: number; lon: number },
): Promise<void> {
  const seconds = (Date.parse(to) - Date.parse(from)) / 1000;
  await t.ctx.db.execute(sql`
    INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, confidence,
      distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
      centroid_lat, centroid_lon, features, version)
    VALUES (${deviceId}, ${from}::timestamptz, ${to}::timestamptz, 'stop', NULL, NULL, NULL,
      0, ${seconds}, 0, 10, ${at.lat}, ${at.lon}, ${at.lat}, ${at.lon},
      ${at.lat}, ${at.lon}, '{}'::jsonb, 3)
  `);
}

/** A move: it ends the stay before it, so that the stops either side are not one stay. */
async function move(deviceId: string, from: string, to: string): Promise<void> {
  await t.ctx.db.execute(sql`
    INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, confidence,
      distance_m, duration_s, max_speed, point_count, start_lat, start_lon, end_lat, end_lon,
      centroid_lat, centroid_lon, features, version)
    VALUES (${deviceId}, ${from}::timestamptz, ${to}::timestamptz, 'move', 'car', 'car', 0.9,
      5000, ${(Date.parse(to) - Date.parse(from)) / 1000}, 20, 10, 51.04, 3.71, 51.06, 3.73,
      51.05, 3.72, '{}'::jsonb, 3)
  `);
}

const heat = (values: Record<string, string | number>, agent: Agent = owner) =>
  agent.get(`${apiPaths.heatmap}?${query({ ...around, zoom: 13, ...period, ...values })}`);
const parsed = async (values: Record<string, string | number>) =>
  heatmapResponseSchema.parse((await heat(values).expect(200)).body);
const tileOf = (at: { lat: number; lon: number }, z: number) =>
  [lonToTileX(at.lon, z), latToTileY(at.lat, z)] as const;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({});
  ({ agent: owner } = await signUpWithCookie(t.app, "first@example.com"));
  const stranger = agentFor(t.app);
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");
  await t.ctx.db.execute(sql`UPDATE users SET timezone = 'UTC' WHERE email = 'first@example.com'`);
  phone = (await createDevice(owner, { name: "Phone" })).device.id;
  tracker = (await createDevice(owner, { name: "Tracker" })).device.id;
  foreign = (await createDevice(stranger, { name: "Stranger's phone" })).device.id;

  // Home: the phone 08:00–10:00 on the 22nd and the tracker 09:00–11:00 the same morning (one
  // stay of 3 h between them), the phone again for an hour on the 24th.
  await stop(phone, "2026-10-22T08:00:00Z", "2026-10-22T10:00:00Z", home);
  await stop(tracker, "2026-10-22T09:00:00Z", "2026-10-22T11:00:00Z", home);
  await stop(phone, "2026-10-24T12:00:00Z", "2026-10-24T13:00:00Z", home);
  await move(phone, "2026-10-22T10:00:00Z", "2026-10-22T10:30:00Z");
  await move(phone, "2026-10-24T11:00:00Z", "2026-10-24T12:00:00Z");
  // The office: a stay that began before the period, 22:00 on the 20th to 02:00 on the 21st.
  await stop(phone, "2026-10-20T22:00:00Z", "2026-10-21T02:00:00Z", office);
  // Before the period, after it and someone else's: not counted.
  await stop(phone, "2026-10-10T08:00:00Z", "2026-10-10T09:00:00Z", far);
  await stop(phone, "2026-10-27T08:00:00Z", "2026-10-27T09:00:00Z", far);
  await stop(foreign, "2026-10-22T08:00:00Z", "2026-10-22T20:00:00Z", home);
  // A stay stored as two parts of one device (as bounded passes leave a long one), 14:00–16:00
  // and 16:00–17:30 on the 23rd at the office: one stay of 3.5 h, one visit.
  await stop(phone, "2026-10-23T14:00:00Z", "2026-10-23T16:00:00Z", office);
  await stop(phone, "2026-10-23T16:00:00Z", "2026-10-23T17:30:00Z", office);
  // A stay across the period's end: 22:00 on the 25th to 02:00 on the 26th, 2 h of it counted.
  await stop(phone, "2026-10-25T22:00:00Z", "2026-10-26T02:00:00Z", far);
});

afterAll(async () => {
  await t.close();
});

describe("heat=time and heat=visits", () => {
  it("counts the time a place was somebody's, two phones once, clipped to the period", async () => {
    const answer = await parsed({ heat: "time" });
    expect(answer).toMatchObject({ heat: "time", cellZoom: 18, truncated: false, pending: false });
    expect(answer.period).toEqual(period);
    const [homeX, homeY] = tileOf(home, 18);
    const [officeX, officeY] = tileOf(office, 18);
    const [farX, farY] = tileOf(far, 18);
    // Home 08:00–11:00 (3 h) and 12:00–13:00 (1 h); the office from midnight of the 21st (2 h) and
    // its two parts of the 23rd as one stay (3.5 h); the far place only until the period's end (2 h).
    expect(answer.cells).toEqual([
      [officeX, officeY, 2 * 3600 + 3.5 * 3600],
      [homeX, homeY, 4 * 3600],
      [farX, farY, 2 * 3600],
    ]);
  });

  it("counts a stay once as one visit, however many phones and parts, and one that began before the period", async () => {
    const answer = await parsed({ heat: "visits" });
    const [homeX, homeY] = tileOf(home, 18);
    const [officeX, officeY] = tileOf(office, 18);
    const [farX, farY] = tileOf(far, 18);
    expect(answer.heat).toBe("visits");
    // The office: the stay from before the period and the two parts of the 23rd, two visits.
    // Equal visits: the one with more time first.
    expect(answer.cells).toEqual([
      [officeX, officeY, 2],
      [homeX, homeY, 2],
      [farX, farY, 1],
    ]);
  });

  it("takes the days from the first with data to today when no period is asked", async () => {
    const answer = heatmapResponseSchema.parse(
      (
        await owner
          .get(`${apiPaths.heatmap}?${query({ ...around, zoom: 13, heat: "time" })}`)
          .expect(200)
      ).body,
    );
    expect(answer.period?.from).toBe("2026-10-10");
    expect(answer.period?.to).toBe(new Date().toISOString().slice(0, 10));
  });

  it("answers at the cell zoom of the map zoom, tiles at 6, 13 and 20", async () => {
    for (const [zoom, cellZoom] of [
      [1, 6],
      [8, 13],
      [15, 20],
      [20, 20],
    ] as const) {
      const answer = await parsed({ heat: "time", zoom, bbox: "-10,40,20,60" });
      expect(answer.cellZoom, `zoom ${zoom}`).toBe(cellZoom);
      const [x, y] = tileOf(home, cellZoom);
      const homeCell = answer.cells.find((cell) => cell[0] === x && cell[1] === y);
      expect(homeCell, `zoom ${zoom}`).toBeDefined();
      expect(homeCell?.[2]).toBeGreaterThanOrEqual(4 * 3600);
    }
  });

  it("keeps to the view's cells and finds the cells of both sides of the antimeridian", async () => {
    await stop(phone, "2026-10-23T08:00:00Z", "2026-10-23T09:00:00Z", {
      lat: 0.0001,
      lon: 179.9995,
    });
    await stop(phone, "2026-10-23T10:00:00Z", "2026-10-23T12:00:00Z", {
      lat: 0.0001,
      lon: -179.9995,
    });
    const answer = await parsed({ heat: "time", bbox: "179,-1,-179,1", zoom: 12 });
    expect(answer.cells.map((cell) => cell[2])).toEqual([2 * 3600, 3600]);
    const [x] = tileOf({ lat: 0.0001, lon: -179.9995 }, 17);
    expect(answer.cells[0]?.[0]).toBe(x);
    // The same view the other way round holds nothing.
    expect((await parsed({ heat: "time", bbox: "-179,-1,179,1", zoom: 12 })).cells).toEqual([]);
  });

  it("says when the ceiling cut the cells, and keeps the busiest", async () => {
    const found = await findStopCells(t.ctx.db, {
      deviceIds: [phone],
      heat: "time",
      bbox: [3.5, 50.9, 4, 51.3],
      cellZoom: 18,
      start: new Date("2026-10-21T00:00:00Z"),
      end: new Date("2026-10-26T00:00:00Z"),
      limit: 1,
    });
    expect(found.truncated).toBe(true);
    expect(found.cells).toHaveLength(1);
    // The phone's office: the stay from the 20th clipped (2 h) and the two parts of the 23rd (3.5 h).
    expect(found.cells[0]?.[2]).toBe(5.5 * 3600);
  });

  it("is empty where nothing was, and follows the account's time zone for the days", async () => {
    expect((await parsed({ heat: "time", bbox: "10,40,11,41" })).cells).toEqual([]);
    await t.ctx.db.execute(
      sql`UPDATE users SET timezone = 'Pacific/Kiritimati' WHERE email = 'first@example.com'`,
    );
    try {
      // 14 hours ahead: the 21st begins at 10:00 UTC on the 20th, and the office stay is whole.
      const [officeX, officeY] = tileOf(office, 18);
      const answer = await parsed({ heat: "time" });
      expect(answer.cells.find((cell) => cell[0] === officeX && cell[1] === officeY)?.[2]).toBe(
        4 * 3600 + 3.5 * 3600,
      );
    } finally {
      await t.ctx.db.execute(
        sql`UPDATE users SET timezone = 'UTC' WHERE email = 'first@example.com'`,
      );
    }
  });

  it("flags recent days that are still being worked out", async () => {
    expect((await parsed({ heat: "time" })).pending).toBe(false);
    await t.ctx.db.execute(sql`
      INSERT INTO processing_queue (device_id, from_at, to_at, reason, from_level, priority, next_at)
      VALUES (${phone}::uuid, '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z', 'backfill', 'inferred', 2, now())
    `);
    expect((await parsed({ heat: "time" })).pending).toBe(true);
    await t.ctx.db.execute(sql`DELETE FROM processing_queue`);
  });

  it("limits to the devices asked for, and a foreign one is a 404", async () => {
    const only = await parsed({ heat: "time", deviceIds: tracker });
    expect(only.cells.map((cell) => cell[2])).toEqual([2 * 3600]);
    const refused = await heat({ heat: "time", deviceIds: foreign }).expect(404);
    expect(apiErrorSchema.parse(refused.body).error.code).toBe("not_found");
  });

  it("refuses a period for points, an upside-down one and one over three years", async () => {
    for (const bad of [
      { heat: "points" },
      { heat: "time", from: "2026-10-25", to: "2026-10-21" },
      { heat: "visits", from: "2020-01-01", to: "2026-10-21" },
      { heat: "bogus" },
      { heat: "time", mode: "car" },
    ]) {
      await heat(bad).expect(400);
    }
  });

  it("answers 304 to its own ETag and 200 after a new stop or a change of time zone", async () => {
    const first = await heat({ heat: "time" }).expect(200);
    const etag = String(first.headers["etag"]);
    await heat({ heat: "time" }).set("If-None-Match", etag).expect(304);
    await stop(tracker, "2026-10-25T08:00:00Z", "2026-10-25T09:00:00Z", home);
    const afterStop = await heat({ heat: "time" }).set("If-None-Match", etag).expect(200);
    const second = String(afterStop.headers["etag"]);
    expect(second).not.toBe(etag);
    await heat({ heat: "time" }).set("If-None-Match", second).expect(304);
    await t.ctx.db.execute(
      sql`UPDATE users SET timezone = 'Europe/Brussels' WHERE email = 'first@example.com'`,
    );
    const afterZone = await heat({ heat: "time" }).set("If-None-Match", second).expect(200);
    expect(String(afterZone.headers["etag"])).not.toBe(second);
    // Another measure of the same view is another answer.
    const visits = await heat({ heat: "visits" }).expect(200);
    expect(String(visits.headers["etag"])).not.toBe(String(afterZone.headers["etag"]));
  });
});

describe("the tile maths of the cells", () => {
  it("is one definition: SQL, the stored cells and tileMath agree at 6, 13 and 20", async () => {
    const points = [
      { lat: 51.0362, lon: 3.7104 },
      { lat: -33.8688, lon: 151.2093 },
      { lat: 0, lon: 0 },
      { lat: 85.06, lon: 179.999 },
      { lat: -85.06, lon: -179.999 },
      { lat: 89.9, lon: -180 },
    ];
    for (const z of [6, 13, 20]) {
      for (const point of points) {
        const row = (
          await t.ctx.db.execute<{ x: number; y: number }>(sql`
            SELECT ${tileXSql(sql`${point.lon}::float8`, sql`${z}::int`)} AS x,
              ${tileYSql(sql`${point.lat}::float8`, sql`${z}::int`)} AS y
          `)
        ).rows[0];
        expect([row?.x, row?.y], `${point.lat},${point.lon} at ${z}`).toEqual([
          lonToTileX(point.lon, z),
          latToTileY(point.lat, z),
        ]);
      }
    }
    // The stored cells are those tiles.
    const probe = (await createDevice(owner, { name: "Probe" })).device.id;
    await t.ctx.db.execute(
      heatCellsUpsert(
        probe,
        sql`(SELECT now() AS recorded_at, ${home.lat}::float8 AS lat, ${home.lon}::float8 AS lon, NULL::float8 AS horizontal_accuracy)`,
      ),
    );
    const stored = await t.ctx.db.execute<{ z: number; x: number; y: number }>(
      sql`SELECT z, x, y FROM heat_cells WHERE device_id = ${probe}::uuid ORDER BY z`,
    );
    expect(stored.rows.map((row) => [row.z, row.x, row.y])).toEqual(
      [6, 9, 12, 15, 18, 20].map((z) => [z, ...tileOf(home, z)]),
    );
  });
});
