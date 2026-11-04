import { describe, expect, it } from "vitest";
import { accuracyFeatures } from "../src/map/accuracyFeatures";
import { boundsOf } from "../src/map/boundsOf";
import { circleRing } from "../src/map/circleRing";
import { heatmapParamsFor } from "../src/map/heatmapParamsFor";
import { metresBetween } from "../src/map/lineGeometry";
import { pointFeatures } from "../src/map/pointFeatures";
import { positionExtent } from "../src/map/positionExtent";
import { rasterStyle } from "../src/map/rasterStyle";
import { splitTrackAt } from "../src/map/splitTrackAt";
import { trackFeatures } from "../src/map/trackFeatures";
import { tracksToMap } from "../src/map/tracksToMap";
import { transportFeatures } from "../src/map/transportFeatures";
import { personPositions } from "../src/people/personPositions";
import { levelTracksToMap } from "../src/transport/levelTracksToMap";
import { ana, bob, ids, levelTracks, tracks } from "./support/fixtures";

describe("map helpers", () => {
  it("rounds heatmap requests outward and clamps world copies", () => {
    expect(
      heatmapParamsFor({ bounds: [3.51234, 50.98001, 3.72001, 51.05999], zoom: 11.6 }, null),
    ).toEqual({
      bbox: "3.512,50.98,3.721,51.06",
      zoom: 12,
      deviceIds: null,
      heat: "points",
      from: null,
      to: null,
      mode: null,
    });
    // A period belongs to the measures that have one; points are all time.
    const view = { bounds: [3.5, 51, 3.7, 51.1], zoom: 12 } as const;
    const period = { from: "2026-10-01", to: "2026-10-31" };
    expect(heatmapParamsFor(view, null, { heat: "time", period })).toMatchObject({
      heat: "time",
      ...period,
    });
    expect(heatmapParamsFor(view, null, { heat: "visits", period: null })).toMatchObject({
      heat: "visits",
      from: null,
      to: null,
    });
    expect(heatmapParamsFor(view, null, { heat: "points", period })).toMatchObject({
      from: null,
      to: null,
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

describe("dimming what the playback cursor has not reached", () => {
  // Points a minute apart along a line: t = 1000, 1060, 1120, 1180; the cursor is mid-way.
  const point = (lon: number, t: number) => [lon, 51, t, 5, 5, null] as const;
  const line = [point(3, 1000), point(3.1, 1060), point(3.2, 1120), point(3.3, 1180)] as const;

  it("cuts a piece of track at the cursor, both parts meeting at its interpolated position", () => {
    const { played, ahead } = splitTrackAt(line, 1090);
    expect(played.map(([lon]) => lon)).toEqual([3, 3.1, expect.closeTo(3.15, 6)]);
    expect(ahead.map(([lon]) => lon)).toEqual([expect.closeTo(3.15, 6), 3.2, 3.3]);
  });

  it("leaves a piece wholly on one side whole, and cuts nothing out of a gap", () => {
    expect(splitTrackAt(line, 2000)).toEqual({ played: expect.any(Array), ahead: [] });
    expect(splitTrackAt(line, 2000).played).toHaveLength(4);
    expect(splitTrackAt(line, 10)).toEqual({ played: [], ahead: expect.any(Array) });
    expect(splitTrackAt(line, 10).ahead).toHaveLength(4);
    const gapped = [point(3, 1000), point(3.1, 1060), point(3.2, 3000), point(3.3, 3060)] as const;
    const { played, ahead } = splitTrackAt(gapped, 2000);
    expect(played).toEqual([
      [3, 51],
      [3.1, 51],
    ]);
    expect(ahead).toEqual([
      [3.2, 51],
      [3.3, 51],
    ]);
    expect(splitTrackAt([], 5)).toEqual({ played: [], ahead: [] });
  });

  it("gives tracks as before without a cursor, and played plus dimmed ahead with one", () => {
    const [track] = tracks("2026-09-29T22:00:00.000Z", "2026-09-30T22:00:00.000Z").tracks;
    if (track === undefined) throw new Error("no track in the fixture");
    const times = track.points.map((p) => p[2]);
    const middle = ((times[0] ?? 0) + (times.at(-1) ?? 0)) / 2;
    const plain = tracksToMap([track], () => "#c");
    expect(plain).toHaveLength(1);
    expect(plain[0]).not.toHaveProperty("dimmed");
    const cut = tracksToMap([track], () => "#c", middle);
    // The faded part is drawn first, so that the played line lies over it.
    expect(cut.map((part) => part.dimmed ?? false)).toEqual([true, false]);
    expect(cut.every((part) => part.color === "#c" && part.id === track.deviceId)).toBe(true);
    // Before the first point everything is ahead, after the last everything is played.
    expect(tracksToMap([track], () => "#c", (times[0] ?? 0) - 10).map((p) => p.dimmed)).toEqual([
      true,
    ]);
    expect(tracksToMap([track], () => "#c", (times.at(-1) ?? 0) + 10).map((p) => p.dimmed)).toEqual(
      [undefined],
    );
  });

  it("carries dimmed into the features of lines, dots and segments, and only then", () => {
    const track = {
      id: "d",
      color: "#c",
      segments: [
        [
          [3, 51],
          [3.1, 51],
        ],
      ] as const,
    };
    const features = trackFeatures([track, { ...track, dimmed: true }]).features;
    expect(features.map((f) => f.properties)).toEqual([
      { color: "#c" },
      { color: "#c", dimmed: true },
    ]);
    expect(
      pointFeatures([
        { id: "a", color: "#c", lon: 3, lat: 51 },
        { id: "b", color: "#c", lon: 3, lat: 51, dimmed: true },
      ]).features.map((f) => f.properties),
    ).toEqual([{ color: "#c" }, { color: "#c", dimmed: true }]);
    const segment = {
      id: "m",
      selectable: true,
      kind: "move" as const,
      color: "#m",
      review: false,
      line: [
        [3, 51],
        [3.1, 51],
      ] as const,
      place: null,
      spreadM: null,
    };
    const { lines } = transportFeatures([segment, { ...segment, id: "n", dimmed: true }]);
    expect(lines.features.map((f) => f.properties.dimmed)).toEqual([undefined, true]);
  });

  it("cuts a move of the Transport level at the cursor and dims a stop it has not reached", () => {
    const response = levelTracks(
      "2026-09-29T22:00:00.000Z",
      "2026-09-30T22:00:00.000Z",
      "inferred",
    );
    const [stop, move] = response.segments;
    if (stop === undefined || move === undefined) throw new Error("fixture");
    const colors = { device: () => "#device", mode: (mode: string) => `#${mode}` };
    const moveTimes = move.points.map((p) => p[2]);
    const middle = ((moveTimes[0] ?? 0) + (moveTimes.at(-1) ?? 0)) / 2;
    const during = levelTracksToMap(response, colors, middle).transport;
    expect(during.map((s) => [s.kind, s.dimmed ?? false])).toEqual([
      ["stop", false],
      ["move", true],
      ["move", false],
    ]);
    // Both halves are the segment: a click on either opens it, and a selection lights both.
    const parts = during.filter((s) => s.kind === "move");
    expect(parts).toHaveLength(2);
    expect(parts[1]?.id).toBe(parts[0]?.id);
    expect(parts.every((part) => part.line.length > 0)).toBe(true);
    const before = levelTracksToMap(response, colors, (stop.points[0]?.[2] ?? 0) - 1).transport;
    expect(before.map((s) => s.dimmed)).toEqual([true, true]);
    // Without a cursor nothing is dimmed, and the other levels give played and ahead tracks.
    expect(levelTracksToMap(response, colors).transport.some((s) => "dimmed" in s)).toBe(false);
    const raw = levelTracks("2026-09-29T22:00:00.000Z", "2026-09-30T22:00:00.000Z", "raw");
    const rawTimes = raw.segments.flatMap((s) => s.points.map((p) => p[2]));
    const rawCut = levelTracksToMap(raw, colors, ((rawTimes[0] ?? 0) + (rawTimes.at(-1) ?? 0)) / 2);
    expect(rawCut.tracks.map((t) => t.dimmed ?? false)).toEqual([true, false]);
  });

  it("dims a connector across a gap that lies after the cursor", () => {
    const response = levelTracks(
      "2026-09-29T22:00:00.000Z",
      "2026-09-30T22:00:00.000Z",
      "inferred",
    );
    const [stop, move] = response.segments;
    if (stop === undefined || move === undefined) throw new Error("fixture");
    // The move starts far from where the stop ended, and later: a connector between them.
    const apart = {
      ...response,
      segments: [
        stop,
        { ...move, points: move.points.map((p) => [p[0] + 1, p[1] + 1, p[2] + 5000] as const) },
      ],
    };
    const colors = { device: () => "#device", mode: (mode: string) => `#${mode}` };
    const kinds = (until?: number) =>
      levelTracksToMap(apart as typeof response, colors, until).transport.map(
        (s) => `${s.kind}${s.dimmed === true ? ":dimmed" : ""}`,
      );
    expect(kinds()).toContain("gap");
    const stopEnd = stop.points.at(-1)?.[2] ?? 0;
    // The cursor in the stop: the connector (and the move after it) are still ahead.
    expect(kinds(stopEnd - 1)).toContain("gap:dimmed");
    // The cursor past the move's start: the connector is behind it.
    expect(kinds(stopEnd + 6000)).toContain("gap");
  });
});
