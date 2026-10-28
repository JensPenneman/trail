import type { Client } from "@modelcontextprotocol/client";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsOverviewSchema } from "@trail/contracts/insights";
import {
  getDaySummaryOutputSchema,
  getTimelineOutputSchema,
  getVisitsOutputSchema,
} from "@trail/contracts/mcp";
import {
  deviceModeResponseSchema,
  levelTracksResponseSchema,
  modeStatsResponseSchema,
  type Segment,
  timelineResponseSchema,
} from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { countStops } from "../../src/insights/insightMoves";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import { createApiToken } from "../support/apiTokenFlows";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { morning } from "../support/journeys";
import { connectMcp } from "../support/mcpClient";
import { uploadJourney, uploadVisits } from "../support/overlandPoints";
import { assertSegmentInvariants, processingFingerprint } from "../support/processingInvariants";
import { resetDatabase } from "../support/resetDatabase";
import { concat, lastT, stay, toLonLat, travel, type Vertex } from "../support/syntheticWorld";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * A stay is one stop wherever it is served. Bounded passes work a long stay
 * out a part at a time, so it is stored as stops one after the other at one
 * place; the timeline (v1 and MCP), the map's tracks, the day summary,
 * Insights and the mode statistics serve them as the one stop it was, and
 * the stored segments stay as the passes left them.
 */
let t: TestContext;
let owner: Agent;
let client: Client;

const home: Vertex = [-1000, -200];
const work: Vertex = [-1000, 4600];
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  ({ agent: owner } = await signUpWithCookie(t.app, "first@example.com"));
  const token = await createApiToken(owner, {
    name: "Stays",
    scopes: ["locations:read", "history:read"],
    deviceIds: null,
    expiresAt: null,
  });
  ({ client } = await connectMcp(t.app, token.secret));
});

afterAll(async () => {
  await client.close();
  await t.close();
});

async function newDevice(name: string) {
  const device = await createDevice(owner, { name });
  return { id: device.device.id, token: device.credentials.accessToken, name };
}

async function upload(token: string, points: readonly RawPoint[]) {
  await uploadJourney(t.app, token, points);
  await t.ctx.background.drain(5000);
}

/** The timeline of a range, every page of `limit` items. */
async function timeline(deviceId: string, from: string, to: string, limit = 500) {
  const items: Segment[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = timelineResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.segments.root)
          .query({
            devices: deviceId,
            from,
            to,
            limit,
            ...(cursor === undefined ? {} : { cursor }),
          })
          .expect(200)
      ).body,
    );
    items.push(...page.items);
    if (page.nextCursor === null) return items;
    cursor = page.nextCursor;
  }
}

/** The stops of a device as the passes stored them. */
const storedStops = async (deviceId: string) =>
  (
    await t.ctx.db.execute<{ id: string; from: string; to: string; points: number }>(sql`
      SELECT id, started_at::text AS from, ended_at::text AS to, point_count AS points
      FROM segments WHERE device_id = ${deviceId} AND kind = 'stop' ORDER BY started_at
    `)
  ).rows;

/** Calls a tool and parses its structured content with the tool's own output schema. */
async function call<S extends z.ZodType>(
  name: string,
  args: Record<string, unknown>,
  schema: S,
): Promise<z.output<S>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  return schema.parse(result.structuredContent);
}

/** A local date of the account's time zone (Europe/Brussels). */
const localDate = (epochSeconds: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(
    new Date(epochSeconds * 1000),
  );

describe("stops of one stay", () => {
  /**
   * Inserts a stored segment as a pass would leave it: ten points of its own around `at`, from
   * `start` to `end` (both `at` unless given), a stop's spread 20 m and its last point at its end.
   */
  async function segment(
    deviceId: string,
    kind: "stop" | "move",
    from: number,
    to: number,
    at: Vertex,
    options: { start?: Vertex; end?: Vertex; spreadM?: number; lastPointT?: number } = {},
  ) {
    const [lon, lat] = toLonLat(at[0], at[1]);
    const [startLon, startLat] = toLonLat(...(options.start ?? at));
    const [endLon, endLat] = toLonLat(...(options.end ?? at));
    const features =
      kind === "stop"
        ? { spreadM: options.spreadM ?? 20, lastPointT: options.lastPointT ?? to }
        : {};
    await t.ctx.db.execute(sql`
      INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, distance_m,
        duration_s, point_count, start_lat, start_lon, end_lat, end_lon, centroid_lat, centroid_lon,
        features, version)
      VALUES (${deviceId}, to_timestamp(${from}), to_timestamp(${to}), ${kind},
        ${kind === "move" ? "walking" : null}, ${kind === "move" ? "walking" : null}, 0, ${to - from},
        10, ${startLat}, ${startLon}, ${endLat}, ${endLon}, ${lat}, ${lon},
        ${JSON.stringify(features)}::jsonb, 3)
    `);
  }

  it("are one stop when they meet at one place, two across a move, a jump or travel", async () => {
    const device = await newDevice("Hand-made stays");
    const start = morning - 320 * 86_400;
    const h = 3600;
    // One place, two stops that meet: one stay.
    await segment(device.id, "stop", start, start + 30 * h, home);
    await segment(device.id, "stop", start + 30 * h, start + 50 * h, [home[0] + 40, home[1]]);
    // A walk away and back: the stop after it is another stop.
    await segment(device.id, "move", start + 50 * h, start + 51 * h, home);
    await segment(device.id, "stop", start + 51 * h, start + 52 * h, home);
    // Right after it, 500 m on: another place.
    await segment(device.id, "stop", start + 52 * h, start + 53 * h, [home[0] + 500, home[1]]);
    // Back home after two hours without a point, 500 m from where it left off: travel between.
    await segment(device.id, "stop", start + 55 * h, start + 56 * h, home);
    const served = await timeline(device.id, iso(start - h), iso(start + 60 * h));
    expect(served.map((item) => [item.kind, item.startedAt, item.endedAt])).toEqual([
      ["stop", iso(start), iso(start + 50 * h)],
      ["move", iso(start + 50 * h), iso(start + 51 * h)],
      ["stop", iso(start + 51 * h), iso(start + 52 * h)],
      ["stop", iso(start + 52 * h), iso(start + 53 * h)],
      ["stop", iso(start + 55 * h), iso(start + 56 * h)],
    ]);
    // The stay under its first part's id, its points counted once at the shared one.
    const [first] = await storedStops(device.id);
    expect(served[0]).toMatchObject({ id: first?.id, durationS: 50 * h, pointCount: 19 });
  });

  it("are one where they meet, or a short hole apart at one place, as the pipeline would", async () => {
    const device = await newDevice("Stays of every shape");
    const h = 3600;
    type Options = Parameters<typeof segment>[5];
    /** Two stops of a case at a place of its own, 2 km and a day from the case before. */
    const cases: {
      name: string;
      first?: Options;
      second: Options & { at: number; after?: number };
      served: number;
      points?: number;
    }[] = [
      // Middles 120 m apart: one stay where they meet at the point they share …
      {
        name: "meet, 120 m",
        first: { end: [60, 0] },
        second: { at: 120, start: [60, 0] },
        served: 1,
        points: 19,
      },
      // … two a ten-minute hole apart: not one place …
      { name: "hole, 120 m", second: { at: 120, after: 600 }, served: 2 },
      // … but one at 90 m, and one 140 m apart where they spread 150 m.
      { name: "hole, 90 m", second: { at: 90, after: 600 }, served: 1, points: 20 },
      {
        name: "hole, 140 m, spread 150 m",
        first: { spreadM: 150 },
        second: { at: 140, after: 600, spreadM: 150 },
        served: 1,
        points: 20,
      },
      // A stop that lasted beyond its last point (a gap the phone lay still through), the next
      // where it ended, 200 m from its middle: one stay, the point at the seam not the first's own.
      {
        name: "after a still gap, 200 m",
        first: { end: [200, 0], lastPointT: 1200 },
        second: { at: 200 },
        served: 1,
        points: 20,
      },
      // Where the next begins 400 m from where the one before ended: two.
      { name: "meet, jumped 400 m", second: { at: 400 }, served: 2 },
    ];
    for (const [index, entry] of cases.entries()) {
      const begin = morning - 322 * 86_400 + index * 86_400;
      const place: Vertex = [index * 2000, -5000];
      const offset = ([x, y]: readonly [number, number]): Vertex => [place[0] + x, place[1] + y];
      const first = entry.first ?? {};
      await segment(device.id, "stop", begin, begin + h, place, {
        ...first,
        ...(first.end === undefined ? {} : { end: offset(first.end) }),
        ...(first.lastPointT === undefined ? {} : { lastPointT: begin + first.lastPointT }),
      });
      const next = begin + h + (entry.second.after ?? 0);
      const { at, after, ...second } = entry.second;
      await segment(device.id, "stop", next, next + h, offset([at, 0]), {
        ...second,
        ...(second.start === undefined ? {} : { start: offset(second.start) }),
      });
      const served = await timeline(device.id, iso(begin - 60), iso(next + h + 60));
      expect(served.length, entry.name).toBe(entry.served);
      if (entry.points !== undefined) expect(served[0]?.pointCount, entry.name).toBe(entry.points);
    }
  });

  it("count a stay that began before a period in the period it began", async () => {
    const device = await newDevice("A stay across a period's start");
    const day = Math.floor((morning - 324 * 86_400) / 86_400) * 86_400;
    const h = 3600;
    // Two parts of one stay: from ten in the evening to six the next evening, across midnight.
    await segment(device.id, "stop", day - 2 * h, day + 10 * h, home);
    await segment(device.id, "stop", day + 10 * h, day + 18 * h, home);
    const counts = await countStops(
      t.ctx.db,
      [device.id],
      [
        { startMs: day * 1000, endMs: (day + 86_400) * 1000 },
        { startMs: (day - 86_400) * 1000, endMs: day * 1000 },
      ],
    );
    expect(counts).toEqual([0, 1]);
  });

  it("are one stop everywhere a three-day stay uploaded at once is served", {
    timeout: 300_000,
  }, async () => {
    const device = await newDevice("Three days at home");
    const start = morning - 330 * 86_400;
    const there = travel([work, home], { startT: start, speedMs: 5, intervalS: 2, seed: 101 });
    const days = stay(home, {
      startT: lastT(there) + 2,
      durationS: 3 * 86_400,
      intervalS: 60,
      seed: 102,
    });
    const away = travel([home, work], {
      startT: lastT(days) + 2,
      speedMs: 5,
      intervalS: 2,
      seed: 103,
    });
    const [lon, lat] = toLonLat(home[0], home[1]);
    await uploadVisits(t.app, device.token, [
      { arrivedAt: days[0]?.t ?? 0, departedAt: lastT(days), lat, lon, accuracy: 20 },
    ]);
    await upload(device.token, concat(there, days, away));
    await t.ctx.processing.flush();
    // As the bounded passes left it: the stay in parts, one after the other.
    const stops = await storedStops(device.id);
    expect(stops.length).toBeGreaterThanOrEqual(2);
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
    const before = await processingFingerprint(t.ctx.db, device.id, {
      from: new Date((start - 3600) * 1000),
      to: new Date((lastT(away) + 3600) * 1000),
    });

    const from = iso(start - 3600);
    const to = iso(lastT(away) + 3600);
    const served = await timeline(device.id, from, to);
    const stay3 = served.filter((item) => item.kind === "stop");
    expect(stay3).toHaveLength(1);
    const [one] = stay3;
    expect(one?.id).toBe(stops[0]?.id);
    expect(one?.startedAt).toBe(new Date(stops[0]?.from ?? "").toISOString());
    expect(one?.endedAt).toBe(new Date(stops.at(-1)?.to ?? "").toISOString());
    expect(one?.durationS).toBe(
      (Date.parse(one?.endedAt ?? "") - Date.parse(one?.startedAt ?? "")) / 1000,
    );
    // Its points each once: what the parts hold of their own, a point two of them share once.
    const own = await t.ctx.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM processed_points
      WHERE device_id = ${device.id} AND kept
        AND recorded_at >= ${one?.startedAt ?? ""}::timestamptz
        AND recorded_at <= ${one?.endedAt ?? ""}::timestamptz
    `);
    expect(one?.pointCount).toBe(own.rows[0]?.count);
    // A page at a time, every stay once.
    const paged = await timeline(device.id, from, to, 1);
    expect(paged.map((item) => item.id)).toEqual(served.map((item) => item.id));

    // The map's tracks name the same stop, over the whole stay.
    const tracks = levelTracksResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.tracks)
          .query({ devices: device.id, from, to, level: "inferred" })
          .expect(200)
      ).body,
    );
    const mapped = tracks.segments.filter((segment) => segment.kind === "stop");
    expect(mapped.map((segment) => [segment.id, segment.startedAt, segment.endedAt])).toEqual([
      [one?.id, one?.startedAt, one?.endedAt],
    ]);

    // Insights counts one stop, the mode statistics one stop a day it spans.
    const firstDay = localDate(start);
    const lastDay = localDate(lastT(away));
    const overview = insightsOverviewSchema.parse(
      (
        await owner
          .get(apiPaths.v1.insights.overview)
          .query({ devices: device.id, from: firstDay, to: lastDay })
          .expect(200)
      ).body,
    );
    expect(overview.totals.stops).toBe(1);
    const stats = modeStatsResponseSchema.parse(
      (
        await owner
          .get(apiPaths.v1.statsModes)
          .query({ devices: device.id, from: firstDay, to: lastDay })
          .expect(200)
      ).body,
    );
    const stationary = stats.days.filter((row) => row.mode === "stationary");
    expect(stationary.length).toBeGreaterThanOrEqual(3);
    expect(stationary.every((row) => row.segments === 1)).toBe(true);

    // The MCP tools agree: one stop on the timeline, one that day, one visit.
    const mcp = await call(
      "get_timeline",
      { from, to, device: device.id },
      getTimelineOutputSchema,
    );
    const mcpStops = mcp.items.filter((item) => item.kind === "stop");
    expect(mcpStops.map((item) => [Date.parse(item.startedAt), Date.parse(item.endedAt)])).toEqual([
      [Date.parse(one?.startedAt ?? ""), Date.parse(one?.endedAt ?? "")],
    ]);
    const middle = localDate((days[0]?.t ?? 0) + 36 * 3600);
    const summary = await call(
      "get_day_summary",
      { date: middle, device: device.id },
      getDaySummaryOutputSchema,
    );
    expect(summary.stops).toBe(1);
    expect(summary.modes.find((row) => row.mode === "stationary")?.segments).toBe(1);
    const visits = await call("get_visits", { from, to, device: device.id }, getVisitsOutputSchema);
    expect(visits.visits).toHaveLength(1);

    // Serving changed nothing that was stored.
    expect(
      await processingFingerprint(t.ctx.db, device.id, {
        from: new Date((start - 3600) * 1000),
        to: new Date((lastT(away) + 3600) * 1000),
      }),
    ).toEqual(before);
  });

  it("are the device's current mode since the stay began, under the stay's id", {
    timeout: 300_000,
  }, async () => {
    // Three days at home up to a minute ago, a point every minute: worked out in parts.
    const device = await newDevice("Home for three days now");
    const now = Math.floor(Date.now() / 1000);
    const days = stay(home, {
      startT: now - 3 * 86_400,
      durationS: 3 * 86_400 - 60,
      intervalS: 60,
      seed: 121,
    });
    await upload(device.token, days);
    await t.ctx.processing.flush();
    const stops = await storedStops(device.id);
    expect(stops.length).toBeGreaterThan(1);
    const answer = deviceModeResponseSchema.parse(
      (await owner.get(apiPaths.v1.devices.mode(device.id)).expect(200)).body,
    );
    expect(answer.mode.current).toEqual({
      mode: "stationary",
      setByUser: false,
      since: new Date(stops[0]?.from ?? "").toISOString(),
      segmentId: stops[0]?.id,
    });
  });

  it("are one stop through 0.5.1's live uploads after days at home", {
    timeout: 300_000,
  }, async () => {
    // Three days at home, a point every ten minutes, by bike to work, two hours there.
    const device = await newDevice("Live after days at home");
    const start = morning - 340 * 86_400;
    const atHome = stay(home, { startT: start, durationS: 3 * 86_400, intervalS: 600, seed: 111 });
    const toWork = travel([home, work], {
      startT: lastT(atHome) + 60,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 112,
    });
    const atWork = stay(work, {
      startT: lastT(toWork) + 2,
      durationS: 7200,
      intervalS: 30,
      seed: 113,
    });
    await upload(device.token, concat(atHome, toWork, atWork));
    await t.ctx.processing.flush();
    // Riding on, an upload every three minutes, each worked out before the next.
    const ride = travel([work, [work[0] + 8000, work[1]]], {
      startT: lastT(atWork) + 2,
      speedMs: 5,
      intervalS: 2,
      motion: ["cycling"],
      seed: 114,
    });
    const riding = ride[0]?.t ?? 0;
    const from = iso(start - 3600);
    for (let index = 0; index < 6; index += 1) {
      await upload(
        device.token,
        ride.filter(
          (point) => point.t >= riding + index * 180 && point.t < riding + (index + 1) * 180,
        ),
      );
      await t.ctx.processing.flush();
      const to = iso(riding + (index + 1) * 180 + 3600);
      const served = (await timeline(device.id, from, to)).filter((item) => item.kind === "stop");
      // Home and work, however many parts the passes left.
      expect(served).toHaveLength(2);
      expect(served[0]?.startedAt).toBe(iso(start));
      const mcp = await call(
        "get_timeline",
        { from, to, device: device.id },
        getTimelineOutputSchema,
      );
      expect(mcp.items.filter((item) => item.kind === "stop")).toHaveLength(2);
    }
    expect((await storedStops(device.id)).length).toBeGreaterThan(2);
    await assertSegmentInvariants(t.ctx.db, device.id, { current: true });
  });
});
