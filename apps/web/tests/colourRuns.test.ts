import type { Track } from "@trail/contracts/track";
import type { LevelTracksResponse } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import {
  classColour,
  colourLevelTracks,
  colourTracks,
  confidenceClass,
  runsOf,
} from "../src/map/pathColour/colourRuns";
import type { PathColouring } from "../src/map/pathColour/pathColours";
import { speedRamp, timeTones } from "../src/map/pathColour/pathPalette";
import { modePalette } from "../src/transport/modePalette";

const colouring = (by: PathColouring["by"], dark = false, onFoot = false): PathColouring => ({
  by,
  dark,
  timeZone: "UTC",
  onFoot,
});

describe("runsOf", () => {
  it("cuts a path into runs of one class that share their boundary points", () => {
    const points = ["a", "b", "c", "d", "e"];
    expect(runsOf(points, [0, 0, 1, 1])).toEqual([
      { cls: 0, points: ["a", "b", "c"] },
      { cls: 1, points: ["c", "d", "e"] },
    ]);
  });

  it("is one run for one class, and one per interval when every one differs", () => {
    expect(runsOf(["a", "b", "c"], [2, 2])).toEqual([{ cls: 2, points: ["a", "b", "c"] }]);
    expect(runsOf(["a", "b", "c"], [0, 1]).map((run) => run.points)).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(runsOf(["a", "b"], [null])).toEqual([{ cls: null, points: ["a", "b"] }]);
    expect(runsOf(["a"], [])).toEqual([]);
  });
});

describe("the colour of a class", () => {
  it("is the ramp's step of the scheme, the time tone, and the unknown mode's for none", () => {
    expect(classColour(2, colouring("speed"))).toBe(speedRamp.light[2]);
    expect(classColour(4, colouring("speed", true))).toBe(speedRamp.dark[4]);
    expect(classColour(3, colouring("time"))).toBe(timeTones.light[3]);
    expect(classColour(null, colouring("speed"))).toBe(modePalette.light.unknown);
  });
});

/** A raw track of `speeds` (m/s) intervals ten seconds apart. */
function track(speeds: number[], start = 1_793_000_000, gapAt?: number): Track {
  const points: Track["points"] = [];
  let lon = 3.7;
  let t = start;
  points.push([lon, 51, t, speeds[0] ?? 0, 5, 8]);
  speeds.forEach((speed, index) => {
    lon += (speed * 10) / 69_800;
    t += gapAt === index ? 900 : 10;
    points.push([lon, 51, t, speed, 5, 8]);
  });
  return {
    deviceId: "00000000-0000-4000-8000-000000000001",
    total: points.length,
    returned: points.length,
    simplified: false,
    distanceM: 0,
    firstAt: null,
    lastAt: null,
    points,
  };
}

describe("colourTracks", () => {
  it("leaves tracks alone by device, and by mode", () => {
    const tracks = [track([2, 2, 2])];
    expect(colourTracks(tracks, colouring("device"))).toEqual(tracks);
    expect(colourTracks(tracks, colouring("mode"))).toEqual(tracks);
  });

  it("cuts a track into runs by speed, each with its colour and sharing its ends", () => {
    // Walking, then driving at 20 m/s: the interval between the two readings is their mean.
    const pieces = colourTracks([track([1, 1, 1, 20, 20, 20, 20])], colouring("speed"));
    expect(pieces.map((piece) => piece.color)).toEqual([
      speedRamp.light[0],
      speedRamp.light[3],
      speedRamp.light[4],
    ]);
    expect(pieces[0]?.points.at(-1)).toEqual(pieces[1]?.points[0]);
    // Three pieces share two points: eight points make ten.
    expect(pieces.flatMap((piece) => piece.points)).toHaveLength(8 + 2);
  });

  it("never carries a run across a recording gap", () => {
    const pieces = colourTracks([track([2, 2, 2, 2, 2], 1_793_000_000, 2)], colouring("speed"));
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.points.at(-1)?.[2]).toBeLessThan(pieces[1]?.points[0]?.[2] ?? 0);
  });

  it("makes one class one run, and colours by the time of day", () => {
    const start = Date.parse("2026-10-27T11:50:00Z") / 1000;
    const pieces = colourTracks([track([5, 5, 5, 5, 5, 5], start)], {
      ...colouring("time"),
      timeZone: "UTC",
    });
    expect(new Set(pieces.map((piece) => piece.color))).toEqual(new Set([timeTones.light[1]]));
  });
});

function levelResponse(level: LevelTracksResponse["level"]): LevelTracksResponse {
  const base = {
    deviceId: "00000000-0000-4000-8000-000000000001",
    level,
    modeInferred: null,
    modeUser: null,
    confidence: null,
    startedAt: "2026-10-27T10:00:00.000Z",
    endedAt: "2026-10-27T10:10:00.000Z",
    distanceM: 100,
    centroid: null,
    spreadM: null,
  } as const;
  const points = [
    [3.7, 51, 1_793_000_000],
    [3.7001, 51, 1_793_000_010],
    [3.7002, 51, 1_793_000_020],
    [3.71, 51, 1_793_000_030],
    [3.72, 51, 1_793_000_040],
  ] as [number, number, number][];
  return {
    level,
    availableLevel: level,
    from: "2026-10-27T00:00:00.000Z",
    to: "2026-10-28T00:00:00.000Z",
    simplified: false,
    stamps: [],
    segments: [
      {
        ...base,
        id: level === "inferred" ? "0199a0f2-1111-7000-8000-000000000001" : null,
        kind: level === "inferred" ? "move" : "track",
        mode: "car",
        needsReview: true,
        points,
      },
      ...(level === "inferred"
        ? [
            {
              ...base,
              id: "0199a0f2-1111-7000-8000-000000000002",
              kind: "stop" as const,
              mode: null,
              needsReview: false,
              points: points.slice(0, 2),
            },
          ]
        : []),
    ],
  } as unknown as LevelTracksResponse;
}

describe("the confidence of a move", () => {
  const move = (extra: Record<string, unknown>) =>
    confidenceClass({
      kind: "move",
      confidence: 0.9,
      needsReview: false,
      modeUser: null,
      ...extra,
    });

  it("is sure from 0.8, fairly sure up to it, unsure under 0.5 or when to review, and sure when chosen", () => {
    expect(move({})).toBe(0);
    expect(move({ confidence: 0.8 })).toBe(0);
    expect(move({ confidence: 0.79 })).toBe(2);
    expect(move({ confidence: 0.5 })).toBe(2);
    expect(move({ confidence: 0.49 })).toBe(4);
    expect(move({ needsReview: true })).toBe(4);
    expect(move({ confidence: 0.3, modeUser: "train" })).toBe(0);
    expect(move({ confidence: null })).toBeNull();
    expect(
      confidenceClass({ kind: "stop", confidence: 1, needsReview: false, modeUser: null }),
    ).toBeNull();
  });
});

describe("colourLevelTracks", () => {
  const device = () => "#112233";

  it("colours a whole move by the confidence of its mode, a stop keeping its own", () => {
    const response = levelResponse("inferred");
    const [move, stop] = response.segments;
    if (move === undefined || stop === undefined) throw new Error("no segments");
    const coloured = colourLevelTracks(
      {
        ...response,
        segments: [{ ...move, confidence: 0.6, needsReview: false } as never, stop],
      },
      colouring("confidence"),
      device,
    );
    expect(coloured.segments).toHaveLength(2);
    expect(coloured.segments[0]?.color).toBe(speedRamp.light[2]);
    expect(coloured.segments[1]?.color).toBeUndefined();
  });

  it("reads the altitude and the accuracy from the column the query asked them in", () => {
    const response = levelResponse("averaged");
    const [segment] = response.segments;
    if (segment === undefined) throw new Error("no segment");
    // Asked as `values=accuracy,altitude`: accuracy in column 3, altitude in column 4.
    const points = [
      [3.7, 51, 1_793_000_000, 4, 120],
      [3.7001, 51, 1_793_000_010, 4, 8],
      [3.7002, 51, 1_793_000_020, 120, 8],
    ] as never;
    const asked = {
      ...response,
      values: ["accuracy", "altitude"],
      segments: [{ ...segment, points }],
    };
    const byAccuracy = colourLevelTracks(asked as never, colouring("accuracy"), device);
    expect(byAccuracy.segments.map((piece) => piece.color)).toEqual([
      speedRamp.light[0],
      speedRamp.light[4],
    ]);
    const scaled = { ...colouring("altitude"), scale: [5, 10, 15, 20] };
    const byAltitude = colourLevelTracks(asked as never, scaled, device);
    expect(byAltitude.segments.map((piece) => piece.color)).toEqual([
      speedRamp.light[4],
      speedRamp.light[1],
    ]);
    // Not asked for: nothing to class, the unknown grey.
    const none = colourLevelTracks(
      { ...response, segments: [{ ...segment, points }] } as never,
      colouring("accuracy"),
      device,
    );
    expect(none.segments.every((piece) => piece.color === modePalette.light.unknown)).toBe(true);
  });

  it("keeps the segments by mode, and by device at the levels that are device lines already", () => {
    const inferred = levelResponse("inferred");
    expect(colourLevelTracks(inferred, colouring("mode"), device)).toBe(inferred);
    const raw = levelResponse("mapped");
    expect(colourLevelTracks(raw, colouring("device"), device)).toBe(raw);
  });

  it("colours every segment of Transport by device, stops included", () => {
    const coloured = colourLevelTracks(levelResponse("inferred"), colouring("device"), device);
    expect(coloured.segments.map((segment) => segment.color)).toEqual(["#112233", "#112233"]);
  });

  it("splits a move into runs by speed, keeping its id and review mark, and leaves a stop the stationary colour", () => {
    const coloured = colourLevelTracks(levelResponse("inferred"), colouring("speed"), device);
    const moves = coloured.segments.filter((segment) => segment.kind === "move");
    expect(moves.length).toBeGreaterThan(1);
    expect(new Set(moves.map((segment) => segment.id))).toEqual(
      new Set(["0199a0f2-1111-7000-8000-000000000001"]),
    );
    expect(moves.every((segment) => segment.needsReview)).toBe(true);
    expect(moves.every((segment) => segment.color !== undefined)).toBe(true);
    expect(coloured.segments.find((segment) => segment.kind === "stop")?.color).toBeUndefined();
  });

  it("draws a move with a pause inside it as one line, as Mode does: no cut at the pause", () => {
    const response = levelResponse("inferred");
    const move = response.segments[0];
    if (move === undefined) throw new Error("no move");
    const slow = [
      [3.7, 51, 1_793_000_000],
      [3.70002, 51, 1_793_000_010],
      [3.70004, 51, 1_793_001_500],
      [3.70006, 51, 1_793_001_510],
    ] as never;
    const coloured = colourLevelTracks(
      { ...response, segments: [{ ...move, points: slow }] },
      colouring("speed"),
      device,
    );
    const lines = coloured.segments.filter((segment) => segment.kind === "move");
    expect(lines.flatMap((segment) => segment.points).length).toBeGreaterThanOrEqual(4);
    expect(lines[0]?.points[0]?.[2]).toBe(1_793_000_000);
    expect(lines.at(-1)?.points.at(-1)?.[2]).toBe(1_793_001_510);
  });

  it("splits the pieces of track of the other levels the same way", () => {
    const coloured = colourLevelTracks(levelResponse("mapped"), colouring("time"), device);
    expect(coloured.segments.length).toBeGreaterThanOrEqual(1);
    expect(coloured.segments.every((segment) => segment.color !== undefined)).toBe(true);
  });
});
