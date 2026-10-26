import { describe, expect, it } from "vitest";
import { averagePoints } from "../../src/processing/averagePoints";
import { type KeptPoint, keptPoints } from "../../src/processing/keptPoint";
import type { RawPoint } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { planWindow, type WindowResult } from "../../src/processing/runPipeline";
import { isAirborne, positionTiles, type TileKey } from "../../src/processing/tileCover";
import { denseDay, flight, motorwayDrive, sparseTrain, walkTrainWalk } from "../support/journeys";
import {
  moves,
  processWorld,
  processWorldInPieces,
  withPieceBudget,
} from "../support/processWorld";
import { origin, railLine, travel } from "../support/syntheticWorld";

const kept = (points: readonly RawPoint[]): KeptPoint[] =>
  keptPoints(points, averagePoints(points, defaultProcessingConfig.averaging));

/** What the timeline shows of a window: its segments with their modes. */
const timeline = (result: WindowResult) =>
  result.segments.map((segment) => ({
    kind: segment.kind,
    mode: segment.modeInferred,
    startT: segment.startT,
    endT: segment.endT,
    confidence: segment.confidence,
    distanceM: Math.round(segment.distanceM),
  }));

describe("map data a piece at a time", () => {
  it("keeps a day's moves together in one piece", () => {
    const plan = planWindow(denseDay(), [], defaultProcessingConfig);
    expect(plan.moves).toHaveLength(2);
    expect(plan.pieces).toHaveLength(1);
    expect(plan.pieces[0]?.stretches.map((stretch) => [stretch.move, stretch.from])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(plan.pieces[0]?.tiles).toEqual(plan.tiles);
  });

  it("cuts a long move into stretches of about the budget, with margins at the seams", () => {
    const budget = 8;
    const config = withPieceBudget(budget);
    const plan = planWindow(motorwayDrive(), [], config);
    const [move] = plan.moves;
    if (move === undefined) throw new Error("no move");
    const points = plan.kept.slice(move.first, move.last + 1);
    const stretches = plan.pieces.flatMap((piece) => piece.stretches);
    expect(plan.pieces.length).toBeGreaterThan(2);
    let next = 0;
    for (const [number, stretch] of stretches.entries()) {
      // Every position is decided once, in order …
      expect(stretch.first).toBe(next);
      next = stretch.last + 1;
      // … matched with a margin of the move beyond each seam …
      if (number > 0) expect(stretch.from).toBeLessThan(stretch.first);
      if (number < stretches.length - 1) expect(stretch.to).toBeGreaterThan(stretch.last);
      // … and without it, within the budget.
      const own = new Set<TileKey>();
      for (let k = stretch.first; k <= stretch.last; k += 1) {
        for (const tile of positionTiles(points, k, k > 0, config)) own.add(tile);
      }
      expect(own.size).toBeLessThanOrEqual(budget);
      for (const tile of own) expect(stretch.tiles.has(tile)).toBe(true);
    }
    expect(next).toBe(points.length);
  });

  it("maps and judges in pieces exactly as in one go", async () => {
    for (const journey of [sparseTrain, motorwayDrive, walkTrainWalk, denseDay]) {
      const points = journey();
      const whole = await processWorldInPieces(points);
      const cut = await processWorldInPieces(points, withPieceBudget(6));
      expect(whole.plan.pieces).toHaveLength(1);
      expect(cut.plan.pieces.length).toBeGreaterThan(2);
      expect(timeline(cut.result)).toEqual(timeline(whole.result));
      expect(cut.result.mapped.map((point) => point?.wayId ?? null)).toEqual(
        whole.result.mapped.map((point) => point?.wayId ?? null),
      );
      for (const [index, point] of cut.result.mapped.entries()) {
        const other = whole.result.mapped[index];
        expect(point?.lat ?? 0).toBeCloseTo(other?.lat ?? 0, 7);
        expect(point?.lon ?? 0).toBeCloseTo(other?.lon ?? 0, 7);
      }
      // The whole map at once (the tests' shortcut) agrees with the tiles' data.
      expect(timeline(processWorld(points))).toEqual(timeline(whole.result));
    }
  });
});

describe("flights", () => {
  it("need no map data and stay off the network", () => {
    const points = flight();
    const plan = planWindow(points, [], defaultProcessingConfig);
    expect(plan.moves.map((move) => move.airborne)).toEqual([true]);
    expect(plan.tiles.size).toBe(0);
    expect(plan.pieces).toEqual([]);
    const result = processWorld(points);
    expect(moves(result).map((move) => move.modeInferred)).toEqual(["plane"]);
    expect(result.missingTiles).toEqual([]);
    const mapped = result.mapped.filter((point) => point !== null);
    expect(mapped.length).toBeGreaterThan(40);
    expect(mapped.every((point) => point.wayId === null && point.path === null)).toBe(true);
  });

  it("are told apart from a high-speed train", () => {
    const train = travel(railLine, {
      startT: 1_793_000_000,
      speedMs: 85,
      intervalS: 10,
      noiseM: 5,
      accuracy: 10,
      seed: 3,
    });
    expect(isAirborne(kept(train), defaultProcessingConfig)).toBe(false);
    expect(isAirborne(kept(flight()), defaultProcessingConfig)).toBe(true);
  });
});

describe("corridors", () => {
  const at = (eastM: number, t: number): KeptPoint => ({
    index: 0,
    t,
    lat: origin.lat,
    lon: origin.lon + eastM / (111_195 * Math.cos((origin.lat * Math.PI) / 180)),
    speed: 0,
    accuracy: 10,
    stationary: false,
    reportedSpeed: null,
    altitude: null,
    verticalAccuracy: null,
    motion: [],
  });

  it("cover the way between distant points, unless only a plane could have flown it", () => {
    const train = [at(0, 0), at(60_000, 1800)];
    const jump = [at(0, 0), at(60_000, 60)];
    // 60 km at 33 m/s: a corridor of tiles along the line.
    expect(positionTiles(train, 1, true, defaultProcessingConfig).size).toBeGreaterThan(40);
    // 60 km in a minute: the point's own tiles only.
    expect(positionTiles(jump, 1, true, defaultProcessingConfig).size).toBeLessThanOrEqual(4);
  });
});
