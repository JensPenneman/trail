import { apiPaths } from "@trail/contracts/apiPaths";
import type { LevelTracksResponse, Segment } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, agentFor, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { uploadJourney } from "../support/overlandPoints";
import { railTrip } from "../support/railTrips";
import { railWorld, roadLine, trackA, trackB } from "../support/railWorld";
import { resetDatabase } from "../support/resetDatabase";
import { distanceToLine, subPath, toXY, type Vertex } from "../support/syntheticWorld";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

/*
 * The train drawn along the railway, through HTTP (docs/architecture.md §17.3 and §17.6): the
 * Transport level serves the rail places of a move whose mode that counts is train and whose
 * verdict is `aligned`; the recorded line stays one level away; a correction switches the line
 * at once. Synthetic rides over `railWorld`, every tile cached by the fixture source.
 */
const base = 1_793_000_000;
const hour = 3600;
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();
const day = { from: iso(base - 3 * hour), to: iso(base + 12 * hour) };

/** The trips, two hours apart: a dense train, a sparse one, a car on a road beside the line, a walk far from it. */
const trips = {
  dense: railTrip(subPath(trackA, 20_000, 40_000), {
    startT: base,
    intervalS: 5,
    noiseM: 6,
    accuracy: 10,
    altitude: 12,
    seed: 1,
  }),
  sparse: railTrip(subPath(trackA, 50_000, 70_000), {
    startT: base + 2 * hour,
    intervalS: 60,
    noiseM: 6,
    accuracy: 10,
    altitude: 12,
    seed: 2,
  }),
  // A car whose phone is no better than 30 m: the road 40 m beside the rails is within what the
  // offsets accept, so only the mapped match (on the road) keeps its rail line from being aligned.
  car: railTrip(roadLine, {
    startT: base + 4 * hour,
    intervalS: 5,
    speedMs: 20,
    noiseM: 6,
    accuracy: 30,
    motion: ["driving"],
    seed: 5,
  }),
  walk: railTrip(
    [
      [80_000, 3000],
      [81_500, 3000],
    ],
    {
      startT: base + 6 * hour,
      intervalS: 2,
      speedMs: 1.4,
      noiseM: 3,
      accuracy: 8,
      motion: ["walking"],
      seed: 6,
    },
  ),
};

let t: TestContext;
let owner: Agent;
let ownerCookie = "";
let deviceId = "";

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: new FixtureWaySource(railWorld()) });
  ({ agent: owner, cookie: ownerCookie } = await signUpWithCookie(t.app, "first@example.com"));
  const device = await createDevice(owner, { name: "Rail rides" });
  deviceId = device.device.id;
  for (const points of Object.values(trips)) {
    await uploadJourney(t.app, device.credentials.accessToken, points);
  }
  await t.ctx.background.drain(5000);
  await t.ctx.processing.flush();
});

afterAll(async () => {
  await t.close();
});

const timeline = async (): Promise<Segment[]> =>
  (await owner.get(apiPaths.v1.segments.root).query(day).expect(200)).body.items as Segment[];

/** The move that starts within a trip's ride. */
async function moveOf(name: keyof typeof trips): Promise<Segment> {
  const first = trips[name][0]?.t ?? 0;
  const last = trips[name].at(-1)?.t ?? 0;
  const found = (await timeline()).find(
    (segment) =>
      segment.kind === "move" &&
      Date.parse(segment.startedAt) / 1000 >= first &&
      Date.parse(segment.endedAt) / 1000 <= last + 1,
  );
  if (found === undefined) {
    const all = (await timeline()).map(
      (segment) => `${segment.kind} ${segment.mode} ${segment.startedAt} ${segment.endedAt}`,
    );
    throw new Error(`no move for the ${name} trip (${first}..${last}): ${all.join("; ")}`);
  }
  return found;
}

const tracks = (query: Record<string, string | number> = {}) =>
  owner.get(apiPaths.v1.tracks).query({ ...day, level: "inferred", maxPoints: 50_000, ...query });

/** The served segment of a move, with the response's ETag. */
async function served(id: string, query: Record<string, string | number> = {}) {
  const response = await tracks(query).expect(200);
  const body = response.body as LevelTracksResponse;
  const segment = body.segments.find((entry) => entry.id === id);
  if (segment === undefined) throw new Error("the move is not in the tracks");
  return { segment, etag: String(response.headers["etag"]) };
}

type Stored = {
  t: number;
  lat_avg: number;
  lon_avg: number;
  lat_map: number | null;
  lon_map: number | null;
  lat_rail: number | null;
  lon_rail: number | null;
};

/** The processed points of a move, oldest first. */
async function stored(move: Segment): Promise<Stored[]> {
  const rows = await t.ctx.db.execute<Stored>(sql`
    SELECT extract(epoch FROM recorded_at)::float8 AS t, lat_avg, lon_avg, lat_map, lon_map,
      lat_rail, lon_rail
    FROM processed_points
    WHERE device_id = ${deviceId} AND kept
      AND recorded_at >= ${move.startedAt}::timestamptz AND recorded_at <= ${move.endedAt}::timestamptz
    ORDER BY recorded_at
  `);
  return rows.rows;
}

type Place = (row: Stored) => [number, number] | null;
const railPlace: Place = (row) =>
  row.lon_rail === null ? null : [row.lon_rail, row.lat_rail ?? 0];
const mappedPlace: Place = (row) => (row.lon_map === null ? null : [row.lon_map, row.lat_map ?? 0]);
const averagedPlace: Place = (row) => [row.lon_avg, row.lat_avg];

type Served = readonly (readonly (number | null)[])[];

/** The served API rounds to 1e-7 degrees. */
const sameDegrees = (a: number, b: number) => Math.abs(a - b) < 2e-7;

/**
 * Checks that every processed point is served at its stored place (the first of `places` it has),
 * and returns the served points that are those: the rest are the way's shape between them.
 */
function expectPlaces(
  segment: { points: Served },
  rows: Stored[],
  places: readonly Place[],
  label: string,
): Set<readonly (number | null)[]> {
  expect(rows.length, `${label}: points`).toBeGreaterThan(5);
  const own = new Set<readonly (number | null)[]>();
  for (const row of rows) {
    const expected = places.map((place) => place(row)).find((place) => place !== null);
    expect(expected, `${label}: a place for ${row.t}`).toBeDefined();
    const found = segment.points.find(
      (point) =>
        point[2] === Math.round(row.t) &&
        sameDegrees(point[0] ?? 0, expected?.[0] ?? 0) &&
        sameDegrees(point[1] ?? 0, expected?.[1] ?? 0),
    );
    expect(found, `${label}: ${row.t} served at ${expected?.join(",")}`).toBeDefined();
    if (found !== undefined) own.add(found);
  }
  return own;
}

/** Every served vertex lies on a main track. */
function expectOnRails(points: Served) {
  for (const point of points) {
    const xy = toXY({ lon: point[0] ?? 0, lat: point[1] ?? 0 });
    const near = Math.min(
      distanceToLine(xy, trackA as Vertex[]),
      distanceToLine(xy, trackB as Vertex[]),
    );
    expect(near).toBeLessThan(1);
  }
}

describe("a train drawn along the railway", () => {
  it("is served on the rails at the Transport level, with alignedTo rail", async () => {
    const move = await moveOf("dense");
    expect(move).toMatchObject({ mode: "train", alignedTo: "rail" });
    const { segment } = await served(move.id);
    expect(segment).toMatchObject({ kind: "move", mode: "train", alignedTo: "rail" });
    expectOnRails(segment.points);
    expectPlaces(segment, await stored(move), [railPlace], "aligned");
  });

  it("draws the points a train shares with its neighbours at their rail place on both sides", async () => {
    const move = await moveOf("dense");
    const response = await tracks().expect(200);
    const segments = (response.body as LevelTracksResponse).segments;
    const at = segments.findIndex((segment) => segment.id === move.id);
    const train = segments[at];
    const before = segments[at - 1];
    const after = segments[at + 1];
    if (train === undefined || before === undefined || after === undefined) {
      throw new Error("the train has no neighbours");
    }
    const first = train.points[0];
    const last = train.points.at(-1);
    // The boundary is shared: the same moment, and the same place, so no break in the line.
    expect(before.points.at(-1)?.slice(0, 3)).toEqual(first?.slice(0, 3));
    expect(after.points[0]?.slice(0, 3)).toEqual(last?.slice(0, 3));
    expect(before.alignedTo).toBeNull();
    expect(after.alignedTo).toBeNull();
    expectOnRails([first ?? [], last ?? []]);
  });

  it("leaves the recorded line one level away: Mapped, Averaged and Raw carry no alignedTo", async () => {
    const move = await moveOf("dense");
    for (const level of ["mapped", "averaged", "raw"] as const) {
      const response = await owner
        .get(apiPaths.v1.tracks)
        .query({ ...day, level, maxPoints: 50_000 })
        .expect(200);
      const segments = (response.body as LevelTracksResponse).segments;
      expect(segments.length, level).toBeGreaterThan(0);
      expect(
        segments.every((segment) => segment.alignedTo === null && segment.kind === "track"),
      ).toBe(true);
    }
    // The mapped columns of the move are what they were: the rail places are columns of their own.
    const rows = await stored(move);
    expect(rows.every((row) => row.lat_map !== null)).toBe(true);
    expect(rows.some((row) => row.lat_rail !== null)).toBe(true);
  });

  it("carries alignedTo in the timeline: only a train move whose points lie on the rails", async () => {
    const items = await timeline();
    const aligned = items.filter((segment) => segment.alignedTo === "rail");
    expect(aligned.map((segment) => segment.mode)).toEqual(["train", "train"]);
    expect(
      items
        .filter((segment) => segment.kind === "stop")
        .every((segment) => segment.alignedTo === null),
    ).toBe(true);
    // The car on the road beside the rails: the mapped match is on the road, so no rail line.
    const car = await moveOf("car");
    expect(car).toMatchObject({ mode: "car", alignedTo: null });
    expect(await railVerdict(car.id)).toBe("poor");
    expect(await railReason(car.id)).toBe("road");
    // A walk far from the tracks has a verdict that is not aligned.
    const walk = await moveOf("walk");
    expect(walk.alignedTo).toBeNull();
    expect(await railVerdict(walk.id)).not.toBe("aligned");
  });

  it("gives the way's shape between points the speed of the point it leads to and no altitude", async () => {
    const move = await moveOf("sparse");
    const { segment } = await served(move.id, { values: "speed,altitude" });
    expect(segment.alignedTo).toBe("rail");
    const own = expectPlaces(segment, await stored(move), [railPlace], "sparse");
    const vertices = segment.points.filter((point) => !own.has(point));
    expect(vertices.length).toBeGreaterThan(5);
    expectOnRails(segment.points);
    for (const [index, point] of segment.points.entries()) {
      if (own.has(point)) {
        // The ends are the stops' points, which carry none.
        if (index > 0 && index < segment.points.length - 1) {
          expect(point[4], "the fix's own altitude").toBe(12);
        }
        continue;
      }
      expect(point[4], "a vertex has no altitude").toBeNull();
      const next = segment.points.slice(index + 1).find((entry) => own.has(entry));
      expect(point[3], "the speed of the point it leads to").toBe(next?.[3]);
    }
  });
});

/** The stored verdict of a move. */
async function railVerdict(id: string): Promise<string | null> {
  const rows = await t.ctx.db.execute<{ status: string | null }>(sql`
    SELECT features->'railPath'->>'status' AS status FROM segments WHERE id = ${id}
  `);
  return rows.rows[0]?.status ?? null;
}

async function railReason(id: string): Promise<string | null> {
  const rows = await t.ctx.db.execute<{ reason: string | null }>(sql`
    SELECT features->'railPath'->>'reason' AS reason FROM segments WHERE id = ${id}
  `);
  return rows.rows[0]?.reason ?? null;
}

const setMode = (id: string, mode: string) =>
  owner.put(apiPaths.v1.segments.mode(id)).set("Origin", testOrigin).send({ mode });

describe("a correction to or from train", () => {
  it("switches the served line at once, both ways, with a new ETag and no reprocessing", async () => {
    const move = await moveOf("sparse");
    const rows = await stored(move);
    const queueBefore = await t.ctx.db.execute(
      sql`SELECT count(*)::int AS n FROM processing_queue`,
    );
    const aligned = await served(move.id);
    // Away from train: the answer says so, and the next read draws the recorded places.
    const toCar = await setMode(move.id, "car").expect(200);
    expect(toCar.body.segment).toMatchObject({ mode: "car", alignedTo: null });
    const recorded = await served(move.id);
    expect(recorded.segment.alignedTo).toBeNull();
    expect(recorded.etag).not.toBe(aligned.etag);
    expectPlaces(recorded.segment, rows, [mappedPlace, averagedPlace], "recorded");
    // And back: aligned again, the same line as before.
    const toTrain = await setMode(move.id, "train").expect(200);
    expect(toTrain.body.segment).toMatchObject({ mode: "train", alignedTo: "rail" });
    const again = await served(move.id);
    expect(again.segment.alignedTo).toBe("rail");
    expect(again.segment.points).toEqual(aligned.segment.points);
    expect(again.etag).not.toBe(recorded.etag);
    // Nothing was queued for it: the same rows wait as before.
    const queueAfter = await t.ctx.db.execute(sql`SELECT count(*)::int AS n FROM processing_queue`);
    expect(queueAfter.rows).toEqual(queueBefore.rows);
  });

  it("leaves a car on a road beside the rails as recorded when it is called a train", async () => {
    const car = await moveOf("car");
    const rows = await stored(car);
    expect(rows.every((row) => row.lat_rail === null)).toBe(true);
    const toTrain = await setMode(car.id, "train").expect(200);
    expect(toTrain.body.segment).toMatchObject({ mode: "train", alignedTo: null });
    const { segment } = await served(car.id);
    expect(segment.alignedTo).toBeNull();
    expectPlaces(segment, rows, [mappedPlace, averagedPlace], "car as train");
    await owner.delete(apiPaths.v1.segments.mode(car.id)).set("Origin", testOrigin).expect(200);
    await t.ctx.processing.flush();
    expect(await moveOf("car")).toMatchObject({ mode: "car", alignedTo: null });
  });

  it("leaves a walk far from the tracks as recorded when it is called a train", async () => {
    const walk = await moveOf("walk");
    const rows = await stored(walk);
    expect(rows.every((row) => row.lat_rail === null)).toBe(true);
    const toTrain = await setMode(walk.id, "train").expect(200);
    expect(toTrain.body.segment).toMatchObject({ mode: "train", alignedTo: null });
    const { segment } = await served(walk.id);
    expect(segment.alignedTo).toBeNull();
    expectPlaces(segment, rows, [mappedPlace, averagedPlace], "walk as train");
    await owner.delete(apiPaths.v1.segments.mode(walk.id)).set("Origin", testOrigin).expect(200);
    await t.ctx.processing.flush();
  });

  it("keeps the inferred train aligned after a reset has been worked out", async () => {
    const move = await moveOf("dense");
    await setMode(move.id, "bus").expect(200);
    expect((await served(move.id)).segment.alignedTo).toBeNull();
    await owner.delete(apiPaths.v1.segments.mode(move.id)).set("Origin", testOrigin).expect(200);
    // The reset is worked out as the worker does it: the span queued again, the verdict stored anew.
    await t.ctx.processing.flush();
    const after = await moveOf("dense");
    expect(after).toMatchObject({ mode: "train", modeUser: null, alignedTo: "rail" });
    const { segment } = await served(after.id);
    expect(segment.alignedTo).toBe("rail");
    expectOnRails(segment.points);
  });
});

describe("a verdict with no mapped match behind it", () => {
  it("is served recorded while the mode is to review, and along the rails once it is not, whatever its source", async () => {
    const move = await moveOf("dense");
    const setRail = (mapped: boolean, source: string, review: boolean) =>
      t.ctx.db.execute(sql`
        UPDATE segments SET review = ${review},
          features = jsonb_set(jsonb_set(features, '{railPath,source}', to_jsonb(${source}::text)),
            '{railPath,mapped}', to_jsonb(${mapped}::boolean))
        WHERE id = ${move.id}
      `);
    try {
      // No mapped match: a car on a road by the rails could not be told, from a region or from the cache.
      for (const source of ["region", "cache"]) {
        await setRail(false, source, true);
        expect(await moveOf("dense"), source).toMatchObject({ needsReview: true, alignedTo: null });
        expect((await served(move.id)).segment.alignedTo, source).toBeNull();
      }
      // The mapped evidence beside it: drawn whether or not to review, whatever the source says.
      for (const source of ["region", "cache"]) {
        await setRail(true, source, true);
        expect((await served(move.id)).segment.alignedTo, source).toBe("rail");
      }
      // Without it, once nobody has to review the mode.
      await setRail(false, "cache", false);
      expect((await served(move.id)).segment.alignedTo).toBe("rail");
      // And once a person has said so, even if it was to review.
      await setRail(false, "region", true);
      await setMode(move.id, "train").expect(200);
      expect((await served(move.id)).segment.alignedTo).toBe("rail");
    } finally {
      await setRail(true, "cache", false);
      await owner.delete(apiPaths.v1.segments.mode(move.id)).set("Origin", testOrigin).expect(200);
      await t.ctx.processing.flush();
    }
  });
});

describe("rail columns without a verdict", () => {
  it("are served as recorded, never half and half", async () => {
    const move = await moveOf("sparse");
    expect((await served(move.id)).segment.alignedTo).toBe("rail");
    // What an older image's write leaves: the points' rail places, no verdict on the segment.
    await t.ctx.db.execute(
      sql`UPDATE segments SET features = features - 'railPath' WHERE id = ${move.id}`,
    );
    const rows = await stored(move);
    expect(rows.some((row) => row.lat_rail !== null)).toBe(true);
    expect((await moveOf("sparse")).alignedTo).toBeNull();
    const { segment } = await served(move.id);
    expect(segment.alignedTo).toBeNull();
    expectPlaces(segment, rows, [mappedPlace, averagedPlace], "no verdict");
  });
});

describe("the kill switch PROCESSING_RAIL_ALIGN=false", () => {
  let off: TestContext;
  let offOwner: Agent;
  beforeAll(async () => {
    // The same database, another process as it were: the app restarted with the switch off.
    off = await createTestContext({
      waySource: new FixtureWaySource(railWorld()),
      env: { PROCESSING_RAIL_ALIGN: "false" },
    });
    offOwner = agentFor(off.app).set("Cookie", ownerCookie);
  });
  afterAll(async () => {
    await off.close();
  });

  const snapshot = async () => {
    const queue = await t.ctx.db.execute(
      sql`SELECT * FROM processing_queue ORDER BY device_id, from_at`,
    );
    const state = await t.ctx.db.execute(sql`SELECT * FROM processing_state ORDER BY key`);
    return { queue: queue.rows, state: state.rows };
  };

  it("hides every rail line at once, moves the ETags and changes nothing in the database", async () => {
    // The rail places are nudged by a metre, so that the rail line differs from the recorded one
    // (both lie on the same track, to the centimetre).
    const car = await moveOf("dense");
    await t.ctx.db.execute(sql`
      UPDATE processed_points SET lat_rail = lat_rail + 0.00001
      WHERE device_id = ${deviceId} AND lat_rail IS NOT NULL
        AND recorded_at >= ${car.startedAt}::timestamptz AND recorded_at <= ${car.endedAt}::timestamptz
    `);
    const on = await served(car.id);
    expect(on.segment.alignedTo).toBe("rail");
    const before = await snapshot();

    const response = await offOwner
      .get(apiPaths.v1.tracks)
      .query({ ...day, level: "inferred", maxPoints: 50_000 })
      .expect(200);
    const body = response.body as LevelTracksResponse;
    expect(body.segments.every((segment) => segment.alignedTo === null)).toBe(true);
    const drawn = body.segments.find((segment) => segment.id === car.id);
    // Drawn at its mapped (else averaged) places, as when it was never aligned.
    expectPlaces(drawn ?? { points: [] }, await stored(car), [mappedPlace, averagedPlace], "off");
    expect(JSON.stringify(drawn?.points)).not.toBe(JSON.stringify(on.segment.points));

    // The ETag moved, and the old one is no longer good for a 304.
    expect(String(response.headers["etag"])).not.toBe(on.etag);
    await offOwner
      .get(apiPaths.v1.tracks)
      .set("If-None-Match", on.etag)
      .query({ ...day, level: "inferred", maxPoints: 50_000 })
      .expect(200);

    // The timeline says the same, with an ETag of its own for each setting.
    const timelineOn = await owner.get(apiPaths.v1.segments.root).query(day).expect(200);
    const timelineOff = await offOwner.get(apiPaths.v1.segments.root).query(day).expect(200);
    expect((timelineOn.body.items as Segment[]).some((item) => item.alignedTo === "rail")).toBe(
      true,
    );
    expect((timelineOff.body.items as Segment[]).every((item) => item.alignedTo === null)).toBe(
      true,
    );
    expect(String(timelineOff.headers["etag"])).not.toBe(String(timelineOn.headers["etag"]));
    await offOwner
      .get(apiPaths.v1.segments.root)
      .set("If-None-Match", String(timelineOn.headers["etag"]))
      .query(day)
      .expect(200);
    // The answer of a correction: the move is a train already, the line is not drawn.
    const put = await offOwner
      .put(apiPaths.v1.segments.mode(car.id))
      .set("Origin", testOrigin)
      .send({ mode: "train" })
      .expect(200);
    expect(put.body.segment).toMatchObject({ mode: "train", alignedTo: null });

    // Nothing was queued or recorded as processing state, and the stored line is as it was.
    expect(await snapshot()).toEqual(before);
    expect(await railVerdict(car.id)).toBe("aligned");
    // The day stamps carry the switch, so a browser holding the day asks again (they stay the same on a stamp read twice).
    const range = { from: "2026-10-25", to: "2026-10-28" };
    await t.ctx.dailyStats.flush();
    const daysOn = (await owner.get(apiPaths.v1.stats.days).query(range).expect(200)).body.days;
    const daysOff = (await offOwner.get(apiPaths.v1.stats.days).query(range).expect(200)).body.days;
    const daysOnAgain = (await owner.get(apiPaths.v1.stats.days).query(range).expect(200)).body
      .days;
    expect(daysOn.length).toBeGreaterThan(0);
    expect(daysOnAgain).toEqual(daysOn);
    expect(daysOff.length).toBe(daysOn.length);
    for (const [index, row] of daysOn.entries()) {
      expect(daysOff[index].stamp.raw).toBe(row.stamp.raw);
      expect(daysOff[index].stamp.processed).not.toBe(row.stamp.processed);
    }
    expect(await snapshot()).toEqual(before);
    // Switching back on brings the line back at once.
    expect((await served(car.id)).segment.points).toEqual(on.segment.points);
    await owner.delete(apiPaths.v1.segments.mode(car.id)).set("Origin", testOrigin).expect(200);
    await t.ctx.processing.flush();
  });
});
