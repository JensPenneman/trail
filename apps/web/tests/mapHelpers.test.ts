import { describe, expect, it } from "vitest";
import { accuracyFeatures } from "../src/map/accuracyFeatures";
import { boundsOf } from "../src/map/boundsOf";
import { circleRing } from "../src/map/circleRing";
import { heatmapParamsFor } from "../src/map/heatmapParamsFor";
import { metresBetween } from "../src/map/lineGeometry";
import { positionExtent } from "../src/map/positionExtent";
import { rasterStyle } from "../src/map/rasterStyle";
import { trackFeatures } from "../src/map/trackFeatures";
import { transportFeatures } from "../src/map/transportFeatures";
import { personPositions } from "../src/people/personPositions";
import { levelTracksToMap } from "../src/transport/levelTracksToMap";
import { ana, bob, ids, levelTracks } from "./support/fixtures";

describe("map helpers", () => {
  it("rounds heatmap requests outward and clamps world copies", () => {
    expect(
      heatmapParamsFor({ bounds: [3.51234, 50.98001, 3.72001, 51.05999], zoom: 11.6 }, null),
    ).toEqual({
      bbox: "3.512,50.98,3.721,51.06",
      zoom: 12,
      deviceIds: null,
    });
    expect(heatmapParamsFor({ bounds: [-200, -95, 200, 95], zoom: 0.4 }, ["a"]).bbox).toBe(
      "-180,-90,180,90",
    );
  });

  it("draws accuracy circles at their true size", () => {
    const ring = circleRing(3.5, 51, 1000, 4);
    expect(ring).toHaveLength(5);
    // North of the centre by one kilometre ≈ 0.009 degrees of latitude.
    expect((ring[0]?.[1] ?? 0) - 51).toBeCloseTo(0.009, 3);
  });

  it("caps a GPS guess's circle, never a share's precision", () => {
    const radiusOf = (feature: { geometry: { coordinates: number[][][] } } | undefined) =>
      ((feature?.geometry.coordinates[0]?.[0]?.[1] ?? 51) - 51) * 111_320;
    const [guess, area] = accuracyFeatures([
      { id: "a", color: "#000", slot: 0, lon: 3.5, lat: 51, accuracy: 9000, live: false },
      {
        id: "b",
        color: "#000",
        slot: 0,
        lon: 3.5,
        lat: 51,
        accuracy: 9000,
        live: false,
        coarse: true,
      },
    ]).features;
    expect(radiusOf(guess)).toBeCloseTo(5000, -2);
    expect(radiusOf(area)).toBeCloseTo(9000, -2);
  });

  it("places people by their initials, coarse where their share is", () => {
    const colors = { slot: () => 2, hex: () => "#123456" };
    const positions = personPositions(
      [ana(), bob()],
      (userId) => (userId === ids.ana ? [ids.anaPhone] : [ids.bobPhone]),
      colors,
      () => true,
    );
    expect(positions).toEqual([
      expect.objectContaining({ id: `${ids.ana}:${ids.anaPhone}`, initials: "AB", coarse: false }),
      expect.objectContaining({
        id: `${ids.bob}:${ids.bobPhone}`,
        initials: "B",
        coarse: true,
        accuracy: 556,
      }),
    ]);
    expect(
      personPositions(
        [ana()],
        () => [],
        colors,
        () => true,
      ),
    ).toEqual([]);
  });

  it("turns a raster tile template into a style, with its credit as text", () => {
    const style = rasterStyle(
      "https://imagery.example.com/{z}/{x}/{y}.jpg",
      'Imagery <b>"X"</b> & Co',
    );
    expect(style.sources["imagery"]).toEqual({
      type: "raster",
      tiles: ["https://imagery.example.com/{z}/{x}/{y}.jpg"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery &lt;b&gt;&quot;X&quot;&lt;/b&gt; &amp; Co",
    });
    expect(style.layers).toEqual([{ id: "imagery", type: "raster", source: "imagery" }]);
  });

  it("skips one-point segments and computes bounds", () => {
    const collection = trackFeatures([
      {
        id: "a",
        color: "#000",
        segments: [
          [[3.5, 51]],
          [
            [3.5, 51],
            [3.6, 51.1],
          ],
        ],
      },
    ]);
    expect(collection.features).toHaveLength(1);
    expect(
      boundsOf([
        [3.5, 51],
        [3.6, 51.1],
      ]),
    ).toEqual([3.5, 51, 3.6, 51.1]);
    expect(boundsOf([])).toBeNull();
  });

  it("frames a coarse share's whole circle, a precise position as its point", () => {
    const position = { id: "a", color: "#000", slot: 0, lon: 3.5, lat: 51, live: false };
    expect(positionExtent({ ...position, accuracy: 12 })).toEqual([[3.5, 51]]);
    const area = boundsOf(positionExtent({ ...position, accuracy: 5560, coarse: true }));
    if (area === null) throw new Error("no extent");
    const [west, south, east, north] = area;
    // About 5.6 km north and south of the centre (0.05° of latitude), as wide east and west.
    expect(north - 51).toBeCloseTo(0.05, 2);
    expect(51 - south).toBeCloseTo(0.05, 2);
    expect((east - 3.5) * Math.cos((51 * Math.PI) / 180)).toBeCloseTo(0.05, 2);
    expect(3.5 - west).toBeCloseTo(east - 3.5, 6);
    expect(positionExtent({ ...position, accuracy: null, coarse: true })).toEqual([[3.5, 51]]);
  });
});

describe("levelTracksToMap", () => {
  const colors = { device: () => "#device", mode: (mode: string) => `#${mode}` };

  it("colours stops and moves by mode, unprocessed track by device", () => {
    const response = levelTracks(
      "2026-09-29T22:00:00.000Z",
      "2026-09-30T22:00:00.000Z",
      "inferred",
    );
    const [, move] = response.segments;
    if (move === undefined) throw new Error("no move in the fixture");
    const unprocessed = {
      ...move,
      id: null,
      kind: "track" as const,
      mode: null,
      needsReview: false,
    };
    const { tracks, transport } = levelTracksToMap(
      { ...response, segments: [...response.segments, unprocessed] },
      colors,
    );
    expect(tracks).toEqual([]);
    expect(
      transport.map((segment) => [segment.kind, segment.color, segment.selectable, segment.review]),
    ).toEqual([
      ["stop", "#stationary", true, false],
      ["move", "#train", true, true],
      // Points not processed yet are no part of the timeline: no connector, wherever they start.
      ["track", "#device", false, false],
    ]);
  });

  it("bridges a recording gap with a connector and gives a stop its place", () => {
    const response = levelTracks(
      "2026-09-29T22:00:00.000Z",
      "2026-09-30T22:00:00.000Z",
      "inferred",
    );
    const [stop, move] = response.segments;
    if (stop === undefined || move === undefined) throw new Error("no segments in the fixture");
    const lastOfMove = move.points.at(-1) ?? [0, 0, 0];
    // The phone came back 700 m north of where the train ride ended, an hour later.
    const later = {
      ...move,
      id: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d49",
      startedAt: new Date((lastOfMove[2] + 3600) * 1000).toISOString(),
      points: [
        [lastOfMove[0], lastOfMove[1] + 0.0063, lastOfMove[2] + 3600],
        [lastOfMove[0], lastOfMove[1] + 0.01, lastOfMove[2] + 3900],
      ] as [number, number, number][],
    };
    const { transport } = levelTracksToMap({ ...response, segments: [stop, move, later] }, colors);
    expect(transport.map((segment) => segment.kind)).toEqual(["stop", "move", "gap", "move"]);
    const gap = transport[2];
    expect(gap).toMatchObject({ selectable: false, color: "#unknown", place: null });
    expect(gap?.line).toEqual([
      [lastOfMove[0], lastOfMove[1]],
      [lastOfMove[0], lastOfMove[1] + 0.0063],
    ]);
    // The stop's dot goes to its place, the middle of its points.
    expect(transport[0]?.place).toEqual([stop.centroid?.lon, stop.centroid?.lat]);
    expect(transport[1]?.place).toBeNull();
  });

  it("bridges the way a stop's phone went before it resumed, and keeps the stop's spread", () => {
    const response = levelTracks(
      "2026-09-29T22:00:00.000Z",
      "2026-09-30T22:00:00.000Z",
      "inferred",
    );
    const [stop, move] = response.segments;
    if (stop === undefined || move === undefined) throw new Error("no segments in the fixture");
    const [lon = 0, lat = 0, t = 0] = stop.points[0] ?? [];
    // Still until a ten-minute pause; the phone resumed 150 m north, riding.
    const paused = { ...stop, spreadM: 4, endedAt: new Date((t + 600) * 1000).toISOString() };
    const ride = {
      ...move,
      startedAt: paused.endedAt,
      points: [
        [lon, lat + 0.00135, t + 600],
        [lon, lat + 0.01, t + 1200],
      ] as [number, number, number][],
    };
    const { transport } = levelTracksToMap({ ...response, segments: [paused, ride] }, colors);
    expect(transport.map((segment) => segment.kind)).toEqual(["stop", "gap", "move"]);
    expect(transport[1]?.line).toEqual([
      [lon, lat],
      [lon, lat + 0.00135],
    ]);
    expect(transport.map((segment) => segment.spreadM)).toEqual([4, null, null]);
  });

  it("connects a device's segments only to its own, and only where they do not meet", () => {
    const response = levelTracks(
      "2026-09-29T22:00:00.000Z",
      "2026-09-30T22:00:00.000Z",
      "inferred",
    );
    const [stop, move] = response.segments;
    if (stop === undefined || move === undefined) throw new Error("no segments in the fixture");
    const otherDevice = { ...move, deviceId: ids.car, id: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d48" };
    const { transport } = levelTracksToMap(
      { ...response, segments: [stop, move, otherDevice] },
      colors,
    );
    // The stop and the move share their boundary point; the car's line is its own.
    expect(transport.map((segment) => segment.kind)).toEqual(["stop", "move", "move"]);
  });

  it("gives tracks in device colours at the other levels", () => {
    const response = levelTracks("2026-09-29T22:00:00.000Z", "2026-09-30T22:00:00.000Z", "mapped");
    const { tracks, transport } = levelTracksToMap(response, colors);
    expect(transport).toEqual([]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.segments[0]).toHaveLength(3);
  });
});

describe("transportFeatures", () => {
  const base = {
    selectable: true,
    color: "#stationary",
    review: false,
    place: null,
    spreadM: null,
  };
  const station: [number, number] = [3.71, 51.0356];

  it("draws a stop that spread with its path dotted, its dot at its place", () => {
    // From the platform to the bike shed, 120 m south.
    const walked = {
      ...base,
      id: "walked",
      kind: "stop" as const,
      line: [station, [3.71, 51.0351], [3.7098, 51.03452]] as const,
      place: [3.71, 51.0349] as const,
      spreadM: 120,
    };
    const still = {
      ...base,
      id: "still",
      kind: "stop" as const,
      line: [station, [3.71005, 51.03565]] as const,
      spreadM: 5,
    };
    // Its points lie 120 m apart, but the phone was still at all but one fix far off.
    const glitch = {
      ...base,
      id: "glitch",
      kind: "stop" as const,
      line: [station, [3.71, 51.0345], station] as const,
      spreadM: 3,
    };
    const { stops, stopPaths, lines, gaps } = transportFeatures([walked, still, glitch]);
    expect(stops.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [3.71, 51.0349],
      station,
      station,
    ]);
    expect(stopPaths.features.map((feature) => feature.properties.id)).toEqual(["walked"]);
    expect(stopPaths.features[0]?.geometry.coordinates).toHaveLength(3);
    expect(lines.features).toEqual([]);
    expect(gaps.features).toEqual([]);
  });

  it("draws a connector apart from the lines, and never as a selectable segment", () => {
    const gap = {
      ...base,
      id: "gap",
      selectable: false,
      kind: "gap" as const,
      color: "#unknown",
      line: [station, [3.72, 51.04]] as const,
    };
    const move = {
      ...base,
      id: "move",
      kind: "move" as const,
      line: [station, [3.7, 51.03]] as const,
    };
    const { lines, gaps } = transportFeatures([move, gap]);
    expect(lines.features.map((feature) => feature.properties.id)).toEqual(["move"]);
    expect(gaps.features.map((feature) => feature.properties)).toEqual([
      { id: "gap", selectable: false, color: "#unknown", review: false },
    ]);
  });

  it("measures how far apart two points lie", () => {
    expect(metresBetween([3.71, 51.0356], [3.71, 51.0347])).toBeCloseTo(100, 0);
  });
});
