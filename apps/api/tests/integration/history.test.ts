import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceResponseSchema } from "@trail/contracts/device";
import { apiErrorSchema } from "@trail/contracts/errors";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { deleteLocationsResponseSchema, locationsPageSchema } from "@trail/contracts/location";
import { activityResponseSchema, daysResponseSchema } from "@trail/contracts/stats";
import { tracksResponseSchema } from "@trail/contracts/track";
import { tripsResponseSchema } from "@trail/contracts/trip";
import { visitsResponseSchema } from "@trail/contracts/visit";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;
let owner: Agent;
let stranger: Agent;
let rideId = "";
let denseId = "";
let denseToken = "";

const day = { from: "2026-09-29T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" };
const query = (values: Record<string, string | number>) =>
  new URLSearchParams(
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
  ).toString();

/** A dense zigzag of `count` points one second apart, starting at `start`. */
const zigzag = (count: number, start: string) => ({
  locations: Array.from({ length: count }, (_, index) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [
        3.6 + index * 0.0001,
        51.0 + (index % 2 === 0 ? 0.0002 : -0.0002) * (index % 40),
      ],
    },
    properties: {
      timestamp: new Date(Date.parse(start) + index * 1000).toISOString().replace(".000Z", "Z"),
      horizontal_accuracy: 5,
      speed: 4,
    },
  })),
});

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  stranger = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  await signUp(stranger, new SoftwareAuthenticator(), "stranger@allowed.test");
  const ride = await createDevice(owner, { name: "iPhone" });
  const dense = await createDevice(owner, { name: "Bike computer" });
  rideId = ride.device.id;
  denseId = dense.device.id;
  denseToken = dense.credentials.accessToken;
  await postOverland(t.app, ride.credentials.accessToken, overlandFixture()).expect(200);
  await postOverland(
    t.app,
    dense.credentials.accessToken,
    zigzag(3000, "2026-09-29T12:00:00Z"),
  ).expect(200);
  // A point from ten minutes ago for the "is data flowing" chart.
  await postOverland(t.app, ride.credentials.accessToken, {
    locations: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [3.7174, 51.0543] },
        properties: {
          timestamp: new Date(Date.now() - 600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
          horizontal_accuracy: 12,
        },
      },
    ],
  }).expect(200);
  await t.ctx.dailyStats.flush();
});

afterAll(async () => {
  await t.close();
});

describe("tracks", () => {
  it("returns the day's track with distance and time range", async () => {
    const response = await owner
      .get(`${apiPaths.tracks}?${query({ ...day, deviceIds: rideId })}`)
      .expect(200);
    const { tracks } = tracksResponseSchema.parse(response.body);
    expect(tracks).toHaveLength(1);
    const [track] = tracks;
    expect(track).toMatchObject({
      deviceId: rideId,
      total: 30,
      returned: 30,
      simplified: false,
      firstAt: "2026-09-29T06:30:15.000Z",
      lastAt: "2026-09-29T07:13:45.000Z",
    });
    // Gent-Sint-Pieters → Deinze along the Leie: about 13–16 km.
    expect(track?.distanceM).toBeGreaterThan(12_000);
    expect(track?.distanceM).toBeLessThan(17_000);
    expect(track?.points[0]).toEqual([
      3.7108,
      51.0357334,
      Date.parse(day.from) / 1000 + 23_415,
      5.3,
      5,
      9,
    ]);
  });

  it("filters by accuracy", async () => {
    const response = await owner
      .get(`${apiPaths.tracks}?${query({ ...day, deviceIds: rideId, maxAccuracy: 5 })}`)
      .expect(200);
    expect(tracksResponseSchema.parse(response.body).tracks[0]?.total).toBe(8);
  });

  it("simplifies long tracks to maxPoints, keeping both ends", async () => {
    const response = await owner
      .get(`${apiPaths.tracks}?${query({ ...day, deviceIds: denseId, maxPoints: 100 })}`)
      .expect(200);
    const track = tracksResponseSchema.parse(response.body).tracks[0];
    expect(track).toMatchObject({ total: 3000, simplified: true });
    expect(track?.returned).toBeLessThanOrEqual(100);
    expect(track?.points[0]?.[2]).toBe(Date.parse("2026-09-29T12:00:00Z") / 1000);
    expect(track?.points.at(-1)?.[2]).toBe(Date.parse("2026-09-29T12:49:59Z") / 1000);
  });

  it("returns every device of the user by default", async () => {
    const response = await owner.get(`${apiPaths.tracks}?${query(day)}`).expect(200);
    expect(tracksResponseSchema.parse(response.body).tracks.map((track) => track.deviceId)).toEqual(
      [rideId, denseId],
    );
  });

  it("rejects ranges longer than 93 days", async () => {
    const response = await owner
      .get(
        `${apiPaths.tracks}?${query({ from: "2026-01-01T00:00:00.000Z", to: "2026-09-29T00:00:00.000Z" })}`,
      )
      .expect(400);
    expect(apiErrorSchema.parse(response.body).error.fields).toHaveProperty("to");
  });
});

describe("heatmap", () => {
  it("returns cell centres in the viewport with all-time counts", async () => {
    const response = await owner
      .get(
        `${apiPaths.heatmap}?${query({ bbox: "3.4,50.9,3.8,51.1", zoom: 11, deviceIds: rideId })}`,
      )
      .expect(200);
    const heatmap = heatmapResponseSchema.parse(response.body);
    expect(heatmap.cellZoom).toBe(15);
    expect(heatmap.truncated).toBe(false);
    expect(heatmap.cells.reduce((sum, cell) => sum + cell[2], 0)).toBe(31);
    for (const [lon, lat] of heatmap.cells) {
      expect(lon).toBeGreaterThan(3.4);
      expect(lat).toBeLessThan(51.1);
    }
  });

  it("is empty elsewhere and handles the antimeridian", async () => {
    const elsewhere = await owner
      .get(`${apiPaths.heatmap}?${query({ bbox: "10,40,11,41", zoom: 9 })}`)
      .expect(200);
    expect(heatmapResponseSchema.parse(elsewhere.body).cells).toEqual([]);
    const pacific = await owner
      .get(`${apiPaths.heatmap}?${query({ bbox: "170,-10,-170,10", zoom: 3 })}`)
      .expect(200);
    expect(heatmapResponseSchema.parse(pacific.body)).toEqual({
      cellZoom: 6,
      cells: [],
      truncated: false,
    });
  });
});

describe("statistics", () => {
  it("has per-day totals in the owner's time zone", async () => {
    const response = await owner
      .get(
        `${apiPaths.statsDays}?${query({ from: "2026-09-28", to: "2026-09-29", deviceIds: rideId })}`,
      )
      .expect(200);
    const { timezone, days } = daysResponseSchema.parse(response.body);
    expect(timezone).toBe("Europe/Brussels");
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: "2026-09-29",
      deviceId: rideId,
      points: 30,
      firstAt: "2026-09-29T06:30:15.000Z",
      lastAt: "2026-09-29T07:13:45.000Z",
    });
    expect(days[0]?.distanceM).toBeGreaterThan(12_000);
  });

  it("buckets recorded points and uploads per hour", async () => {
    const response = await owner
      .get(`${apiPaths.statsActivity}?${query({ hours: 3, deviceIds: rideId })}`)
      .expect(200);
    const activity = activityResponseSchema.parse(response.body);
    expect(activity.buckets).toHaveLength(3);
    expect(activity.buckets.reduce((sum, bucket) => sum + bucket.uploads, 0)).toBe(2);
    expect(activity.buckets.reduce((sum, bucket) => sum + bucket.recorded, 0)).toBe(1);
    expect(Date.parse(activity.to) - Date.parse(activity.from)).toBe(3 * 3_600_000);
  });
});

describe("visits and trips", () => {
  const range = { from: "2026-09-28T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" };

  it("lists visits touching the range", async () => {
    const response = await owner.get(`${apiPaths.visits}?${query(range)}`).expect(200);
    expect(visitsResponseSchema.parse(response.body).visits).toEqual([
      {
        deviceId: rideId,
        recordedAt: "2026-09-29T06:29:10.000Z",
        arrivedAt: "2026-09-28T17:48:12.000Z",
        departedAt: "2026-09-29T06:29:05.000Z",
        lat: 51.0445,
        lon: 3.725,
        accuracy: 35,
      },
    ]);
  });

  it("lists trips overlapping the range", async () => {
    const response = await owner.get(`${apiPaths.trips}?${query(range)}`).expect(200);
    expect(tripsResponseSchema.parse(response.body).trips).toEqual([
      {
        deviceId: rideId,
        startedAt: "2026-09-28T17:02:31.000Z",
        endedAt: "2026-09-28T17:47:55.000Z",
        mode: "bicycle",
        distanceM: 14_873.4,
        durationS: 2724,
        steps: 0,
        stoppedAutomatically: false,
      },
    ]);
  });
});

describe("raw locations", () => {
  it("pages newest first with a keyset cursor", async () => {
    const seen: string[] = [];
    let before: string | null = "2026-09-30T00:00:00.000Z";
    while (before !== null) {
      const response = await owner
        .get(`${apiPaths.locations}?${query({ deviceId: rideId, before, limit: 7 })}`)
        .expect(200);
      const page = locationsPageSchema.parse(response.body);
      seen.push(...page.items.map((item) => item.recordedAt));
      before = page.nextCursor;
    }
    expect(seen).toHaveLength(30);
    expect(seen).toEqual([...seen].sort().reverse());
    expect(new Set(seen).size).toBe(30);
  });
});

describe("export", () => {
  const exportPath = (format: string) =>
    `${apiPaths.export}?${query({ ...day, format, deviceIds: rideId })}`;

  it("streams GeoJSON with Overland's property names", async () => {
    const response = await owner.get(exportPath("geojson")).buffer(true).expect(200);
    expect(response.headers["content-type"]).toBe("application/geo+json; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe(
      // Named after the local (Europe/Brussels) days the UTC range covers.
      'attachment; filename="trail-2026-09-29_2026-09-30.geojson"',
    );
    const collection = JSON.parse(response.text) as {
      type: string;
      features: Array<{ geometry: { coordinates: number[] }; properties: Record<string, unknown> }>;
    };
    expect(collection.type).toBe("FeatureCollection");
    // The day's visit, then its 30 points.
    expect(collection.features).toHaveLength(31);
    expect(collection.features[1]?.properties).toMatchObject({
      kind: "location",
      timestamp: "2026-09-29T06:30:15.000Z",
      device_name: "iPhone",
      motion: ["cycling"],
      unique_id: "5E0B7C1A-8A7D-4C49-9E62-3B2F1D6A0C44",
    });
  });

  it("puts the visits and trips into the GeoJSON, replayable into an Overland receiver", async () => {
    const twoDays = { from: "2026-09-28T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" };
    const response = await owner
      .get(`${apiPaths.export}?${query({ ...twoDays, format: "geojson", deviceIds: rideId })}`)
      .buffer(true)
      .expect(200);
    const { features } = JSON.parse(response.text) as {
      features: Array<{ geometry: unknown; properties: Record<string, unknown> }>;
    };
    const kinds = features.map((feature) => feature.properties["kind"]);
    expect(kinds.filter((kind) => kind === "location")).toHaveLength(30);
    expect(features.find((feature) => feature.properties["kind"] === "visit")).toMatchObject({
      geometry: { type: "Point", coordinates: [3.725, 51.0445] },
      properties: {
        action: "visit",
        timestamp: "2026-09-29T06:29:10.000Z",
        arrival_date: "2026-09-28T17:48:12.000Z",
        departure_date: "2026-09-29T06:29:05.000Z",
        horizontal_accuracy: 35,
        device_name: "iPhone",
      },
    });
    expect(features.find((feature) => feature.properties["kind"] === "trip")).toMatchObject({
      geometry: { type: "Point", coordinates: [3.7249, 51.0443] },
      properties: {
        type: "trip",
        mode: "bicycle",
        start: "2026-09-28T17:02:31.000Z",
        end: "2026-09-28T17:47:55.000Z",
      },
    });

    const copy = await createDevice(owner, { name: "Replayed" });
    await postOverland(t.app, copy.credentials.accessToken, { locations: features }).expect(200);
    const log = await owner
      .get(`${apiPaths.devices.ingestLog(copy.device.id)}?limit=1`)
      .expect(200);
    expect(log.body.entries[0]).toMatchObject({ locations: 30, visits: 1, trips: 1, rejected: 0 });
    await owner.delete(apiPaths.devices.one(copy.device.id)).set("Origin", testOrigin).expect(204);
  });

  it("streams GPX 1.1 with a segment per continuous stretch", async () => {
    const response = await owner.get(exportPath("gpx")).buffer(true).expect(200);
    expect(response.headers["content-type"]).toBe("application/gpx+xml; charset=utf-8");
    const gpx = response.text;
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1"')).toBe(true);
    expect(gpx.match(/<trk>/g)).toHaveLength(1);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
    expect(gpx.match(/<trkpt /g)).toHaveLength(30);
    expect(gpx).toContain("<name>iPhone</name>");
    // GPX 1.1 wants waypoints before tracks: the visit, at its arrival.
    expect(gpx.indexOf("<wpt ")).toBeLessThan(gpx.indexOf("<trk>"));
    expect(gpx).toContain(
      '<wpt lat="51.0445" lon="3.725"><time>2026-09-28T17:48:12.000Z</time><name>Visit · iPhone</name>' +
        "<desc>arrived 2026-09-28T17:48:12.000Z, left 2026-09-29T06:29:05.000Z</desc><type>visit</type></wpt>",
    );
    expect(gpx).toContain(
      '<trkpt lat="51.0357334" lon="3.7108"><ele>9</ele><time>2026-09-29T06:30:15.000Z</time></trkpt>',
    );
    expect(gpx.trimEnd().endsWith("</gpx>")).toBe(true);
  });

  it("writes one track per device and splits it where logging paused", async () => {
    await postOverland(t.app, denseToken, zigzag(2, "2026-09-29T14:00:00Z")).expect(200);
    const response = await owner
      .get(`${apiPaths.export}?${query({ ...day, format: "gpx" })}`)
      .buffer(true)
      .expect(200);
    const tracks = response.text.split("<trk>").slice(1);
    expect(tracks.map((track) => /<name>(.*?)<\/name>/.exec(track)?.[1])).toEqual([
      "iPhone",
      "Bike computer",
    ]);
    expect(tracks.map((track) => track.match(/<trkseg>/g)?.length)).toEqual([1, 2]);
    expect(response.text.match(/<trkpt /g)).toHaveLength(30 + 3002);
  });

  it("streams CSV with a header row", async () => {
    const response = await owner.get(exportPath("csv")).buffer(true).expect(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    const lines = response.text.split("\r\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(31);
    expect(lines[0]).toBe(
      "device_id,device_name,device_key,recorded_at,received_at,lat,lon,altitude,speed,course,horizontal_accuracy,vertical_accuracy,speed_accuracy,course_accuracy,motion,battery_level,battery_state,wifi",
    );
    expect(lines[1]?.startsWith(`${rideId},iPhone,`)).toBe(true);
  });
});

describe("ownership", () => {
  it("hides other people's devices behind 404", async () => {
    for (const path of [
      `${apiPaths.tracks}?${query({ ...day, deviceIds: rideId })}`,
      `${apiPaths.heatmap}?${query({ bbox: "3,50,4,52", zoom: 10, deviceIds: rideId })}`,
      `${apiPaths.statsDays}?${query({ from: "2026-09-29", to: "2026-09-29", deviceIds: rideId })}`,
      `${apiPaths.statsActivity}?${query({ deviceIds: rideId })}`,
      `${apiPaths.visits}?${query({ ...day, deviceIds: rideId })}`,
      `${apiPaths.trips}?${query({ ...day, deviceIds: rideId })}`,
      `${apiPaths.locations}?${query({ deviceId: rideId })}`,
      `${apiPaths.export}?${query({ ...day, format: "csv", deviceIds: rideId })}`,
    ]) {
      const response = await stranger.get(path).expect(404);
      expect(apiErrorSchema.parse(response.body).error.code).toBe("not_found");
    }
    await stranger
      .post(apiPaths.deleteLocations)
      .set("Origin", testOrigin)
      .send({ ...day, deviceId: rideId })
      .expect(404);
  });

  it("gives an empty result to users without devices", async () => {
    const response = await stranger.get(`${apiPaths.tracks}?${query(day)}`).expect(200);
    expect(tracksResponseSchema.parse(response.body).tracks).toEqual([]);
  });
});

describe("deleting a range", () => {
  it("removes points, visits, trips and events and repairs derived data", async () => {
    const response = await owner
      .post(apiPaths.deleteLocations)
      .set("Origin", testOrigin)
      .send({ deviceId: rideId, from: "2026-09-29T06:00:00.000Z", to: "2026-09-29T06:45:00.000Z" })
      .expect(200);
    // 10 points (06:30:15 … 06:43:45), the visit and both log events.
    expect(deleteLocationsResponseSchema.parse(response.body).deleted).toBe(13);

    const device = deviceResponseSchema.parse(
      (await owner.get(apiPaths.devices.one(rideId)).expect(200)).body,
    ).device;
    expect(device.counts.total).toBe(21);
    const cells = await t.ctx.db.execute<{ total: number }>(
      sql`SELECT sum(count)::int AS total FROM heat_cells WHERE device_id = ${rideId} AND z = 12`,
    );
    expect(cells.rows[0]?.total).toBe(21);
    const days = daysResponseSchema.parse(
      (
        await owner
          .get(
            `${apiPaths.statsDays}?${query({ from: "2026-09-29", to: "2026-09-29", deviceIds: rideId })}`,
          )
          .expect(200)
      ).body,
    ).days;
    expect(days[0]).toMatchObject({ points: 20, firstAt: "2026-09-29T06:45:15.000Z" });
  });

  it("clears the cached position when the newest point is deleted", async () => {
    await owner
      .post(apiPaths.deleteLocations)
      .set("Origin", testOrigin)
      .send({ deviceId: denseId, from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" })
      .expect(200);
    const device = deviceResponseSchema.parse(
      (await owner.get(apiPaths.devices.one(denseId)).expect(200)).body,
    ).device;
    expect(device.lastLocation).toBeNull();
    expect(device.counts.total).toBe(0);
  });
});

describe("time zone changes", () => {
  it("rebuild the daily statistics on the new local days", async () => {
    await owner
      .patch("/api/me")
      .set("Origin", testOrigin)
      .send({ timezone: "America/Los_Angeles" })
      .expect(200);
    await t.ctx.background.drain(10_000);
    const response = await owner
      .get(
        `${apiPaths.statsDays}?${query({ from: "2026-09-28", to: "2026-09-29", deviceIds: rideId })}`,
      )
      .expect(200);
    const { timezone, days } = daysResponseSchema.parse(response.body);
    expect(timezone).toBe("America/Los_Angeles");
    // 06:45–07:13 UTC is 23:45–00:13 in Los Angeles: the ride now spans two local days.
    expect(days.map((stat) => [stat.date, stat.points])).toEqual([
      ["2026-09-28", 10],
      ["2026-09-29", 10],
    ]);
  });
});
