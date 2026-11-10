import { describe, expect, it } from "vitest";
import type { MapData } from "../../src/processing/mapData";
import type { RailPathVerdict } from "../../src/processing/pipelineTypes";
import {
  defaultProcessingConfig,
  type ProcessingConfig,
} from "../../src/processing/processingConfig";
import {
  finishWindow,
  inferWindow,
  piecesToAlign,
  planWindow,
  railPiece,
  type WindowResult,
} from "../../src/processing/runPipeline";
import { flight, motorwayDrive, walkTrainWalk } from "../support/journeys";
import { moves, processWorld } from "../support/processWorld";
import { distanceToLine, railLine, toXY, worldMap } from "../support/syntheticWorld";

const off: ProcessingConfig = {
  ...defaultProcessingConfig,
  rail: { ...defaultProcessingConfig.rail, enabled: false },
};

const railPath = (segment: { features: Record<string, unknown> }) =>
  segment.features["railPath"] as RailPathVerdict | undefined;

/** The segments as they were before the rail line: without `features.railPath`. */
const withoutRailPath = (result: WindowResult) =>
  result.segments.map(({ features: { railPath: _railPath, ...features }, ...segment }) => ({
    ...segment,
    features,
  }));

const trainOf = (result: WindowResult) => {
  const train = moves(result).find((segment) => segment.modeInferred === "train");
  if (train === undefined) throw new Error("no train in the window");
  return train;
};

describe("the rail line in the pipeline", () => {
  const points = walkTrainWalk();
  const result = processWorld(points);

  it("aligns the train part and only it: the walks keep their mapped places", () => {
    const train = trainOf(result);
    expect(railPath(train)).toMatchObject({ status: "aligned", reason: "ok", source: "cache" });
    for (const walk of moves(result).filter((segment) => segment.modeInferred === "walking")) {
      expect(railPath(walk)?.status).not.toBe("aligned");
    }
    const placed = result.rail.flatMap((place, index) => (place === null ? [] : [index]));
    expect(placed.length).toBeGreaterThan(50);
    const kept = planWindow(points, [], defaultProcessingConfig).kept;
    const trainFirst = kept[train.first]?.index ?? -1;
    const trainLast = kept[train.last]?.index ?? -1;
    for (const index of placed) {
      expect(index).toBeGreaterThanOrEqual(trainFirst);
      expect(index).toBeLessThanOrEqual(trainLast);
    }
    // The part's first point carries no rail path: the leg into it belongs to the segment before.
    expect(result.rail[trainFirst]?.path ?? null).toBeNull();
    // Every place and every vertex of a path lies on the rails.
    for (const place of result.rail) {
      if (place === null) continue;
      expect(distanceToLine(toXY(place), railLine)).toBeLessThan(1);
      for (const [lon, lat] of place.path ?? []) {
        expect(distanceToLine(toXY({ lat, lon }), railLine)).toBeLessThan(1);
      }
    }
  });

  it("leaves the averaged and mapped levels, and everything the inference found, as they were", () => {
    const without = processWorld(points, { config: off });
    expect(result.averaged).toEqual(without.averaged);
    expect(result.mapped).toEqual(without.mapped);
    expect(withoutRailPath(result)).toEqual(without.segments);
    expect(result.missingTiles).toEqual(without.missingTiles);
  });

  it("with the aligner off writes no verdict and no rail place: the output is what it was", () => {
    const without = processWorld(points, { config: off });
    expect(without.rail.every((place) => place === null)).toBe(true);
    expect(without.rail).toHaveLength(points.length);
    expect(without.segments.every((segment) => !("railPath" in segment.features))).toBe(true);
    // Not even the rail graph is read: a throwing map would show it, but the index is built apart.
    expect(Object.keys(trainOf(without).features)).not.toContain("railPath");
  });

  it("gives the same rail places when worked out again from the stored mapping", () => {
    const plan = planWindow(points, [], defaultProcessingConfig);
    const again = finishWindow(
      plan,
      {
        trips: [],
        overrides: [],
        map: worldMap(),
        available: plan.tiles,
        storedMapping: result.mapped,
      },
      defaultProcessingConfig,
    );
    expect(again.rail).toEqual(result.rail);
    expect(again.segments).toEqual(result.segments);
  });

  it("gives a car on a motorway a verdict and no rail place", () => {
    const drive = processWorld(motorwayDrive());
    const [car] = moves(drive);
    expect(car?.modeInferred).toBe("car");
    expect(railPath(car ?? { features: {} })?.status).not.toBe("aligned");
    expect(drive.rail.every((place) => place === null)).toBe(true);
  });

  it("writes no verdict for a flight, and none without map data", () => {
    const flown = processWorld(flight());
    expect(moves(flown).every((segment) => railPath(segment) === undefined)).toBe(true);
    const bare = processWorld(points, { withMap: false });
    expect(bare.segments.every((segment) => railPath(segment) === undefined)).toBe(true);
  });
});

describe("the rail line of a move whose tiles only a region covers", () => {
  const points = walkTrainWalk();
  const railOnly: MapData = {
    ways: worldMap().ways.filter((way) => way.kind === "rail"),
    pois: [],
  };
  const config = defaultProcessingConfig;
  const plan = planWindow(points, [], config);
  const none = new Set<string>();
  const run = (rail: Parameters<typeof inferWindow>[2]["rail"], mapping = false) =>
    inferWindow(plan, [], { trips: [], overrides: [], mapping, available: none, rail }, config);

  it("is aligned from the rail ways alone, the mapped level staying unmapped", () => {
    const pieces = piecesToAlign(plan, none, plan.tiles);
    expect(pieces.length).toBeGreaterThan(0);
    const stretches = pieces.flatMap((piece) => railPiece(plan, piece, railOnly, config));
    const region = run({ available: plan.tiles, stretches, waiting: false });
    // Whatever mode the weaker evidence of an unmapped move gives it, the part along the rails is aligned.
    const aligned = moves(region).filter((segment) => railPath(segment)?.status === "aligned");
    expect(aligned.length).toBeGreaterThan(0);
    for (const segment of aligned) expect(railPath(segment)).toMatchObject({ source: "region" });
    // The mapped level stays as it is: nothing mapped here.
    expect(region.mapped.every((place) => place === null)).toBe(true);
    const placed = region.rail.filter((place) => place !== null);
    expect(placed.length).toBeGreaterThan(50);
    for (const place of placed) {
      expect(distanceToLine(toXY(place), railLine)).toBeLessThan(1);
    }
  });

  it("is no_map when the tiles are not covered: waiting while Overpass may bring them, else outside regions", () => {
    const waiting = run({ available: none, stretches: [], waiting: true }, true);
    const outside = run({ available: none, stretches: [], waiting: false });
    for (const [result, reason] of [
      [waiting, "waiting"],
      [outside, "outside_regions"],
    ] as const) {
      for (const move of moves(result)) {
        expect(railPath(move)).toMatchObject({ status: "no_map", reason, source: null });
      }
      expect(result.rail.every((place) => place === null)).toBe(true);
    }
  });

  it("writes no verdict without rail inputs, and none with the aligner off", () => {
    expect(moves(run(null)).every((segment) => railPath(segment) === undefined)).toBe(true);
    const stretches = piecesToAlign(plan, none, plan.tiles).flatMap((piece) =>
      railPiece(plan, piece, railOnly, config),
    );
    const switchedOff = inferWindow(
      plan,
      [],
      {
        trips: [],
        overrides: [],
        mapping: false,
        available: none,
        rail: { available: plan.tiles, stretches, waiting: false },
      },
      off,
    );
    expect(switchedOff.rail.every((place) => place === null)).toBe(true);
    expect(moves(switchedOff).every((segment) => railPath(segment) === undefined)).toBe(true);
  });

  it("reads no rail-only piece for a move whose tiles the cache holds", () => {
    expect(piecesToAlign(plan, plan.tiles, plan.tiles)).toEqual([]);
  });
});
