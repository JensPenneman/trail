import { describe, expect, it } from "vitest";
import type { MapData } from "../../src/processing/mapData";
import { noRailPassStats, type RailPathVerdict } from "../../src/processing/pipelineTypes";
import {
  defaultProcessingConfig,
  type ProcessingConfig,
} from "../../src/processing/processingConfig";
import {
  addRailCost,
  finishWindow,
  inferWindow,
  mapPiece,
  piecesToAlign,
  piecesToMap,
  planRailReads,
  planWindow,
  railPiece,
  type WindowResult,
} from "../../src/processing/runPipeline";
import { bikeRide, flight, motorwayDrive, walkInTown, walkTrainWalk } from "../support/journeys";
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
    const pieces = piecesToAlign(plan, none, plan.tiles, config);
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
    const stretches = piecesToAlign(plan, none, plan.tiles, config).flatMap((piece) =>
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
    expect(piecesToAlign(plan, plan.tiles, plan.tiles, config)).toEqual([]);
  });
});

describe("moves that cannot be a train", () => {
  const config = defaultProcessingConfig;
  const none = new Set<string>();
  const cases = [
    ["a walk in town", walkInTown()],
    ["a bike ride", bikeRide()],
  ] as const;

  it.each(cases)(
    "%s whose tiles only a region covers is read for no rail-only piece, and has no verdict",
    (_name, points) => {
      const plan = planWindow(points, [], config);
      expect(plan.moves.length).toBeGreaterThan(0);
      expect(piecesToAlign(plan, none, plan.tiles, config)).toEqual([]);
      // A train over the same tiles is a piece: the check is the move, not the tiles.
      const train = planWindow(walkTrainWalk(), [], config);
      expect(piecesToAlign(train, none, train.tiles, config).length).toBeGreaterThan(0);
      // Whatever its tiles say, no verdict: not waiting, not outside the regions, not aligned.
      for (const waiting of [true, false]) {
        const result = inferWindow(
          plan,
          [],
          {
            trips: [],
            overrides: [],
            mapping: waiting,
            available: none,
            rail: { available: plan.tiles, stretches: [], waiting },
          },
          config,
        );
        expect(moves(result).every((segment) => railPath(segment) === undefined)).toBe(true);
        expect(result.rail.every((place) => place === null)).toBe(true);
      }
    },
  );

  it.each(cases)(
    "%s whose tiles the cache holds gets no aligner call and no cost",
    (_name, points) => {
      const plan = planWindow(points, [], config);
      for (const piece of piecesToMap(plan, plan.tiles)) {
        for (const mapping of mapPiece(plan, piece, worldMap(), undefined, config)) {
          expect(mapping.rail).toBeNull();
          expect(mapping.railCost).toBeNull();
        }
      }
      const stats = noRailPassStats();
      expect(stats.alignedStretches).toBe(0);
    },
  );

  it("a train over the cache's tiles is aligned, and its cost adds up in the pass's statistics", () => {
    const points = walkTrainWalk();
    const plan = planWindow(points, [], config);
    const stats = noRailPassStats();
    for (const piece of piecesToMap(plan, plan.tiles)) {
      for (const mapping of mapPiece(plan, piece, worldMap(), undefined, config)) {
        addRailCost(stats, mapping.railCost);
      }
    }
    expect(stats.alignedStretches).toBeGreaterThan(0);
    expect(stats.steps).toBeGreaterThan(10);
    expect(stats.runs).toBeGreaterThan(0);
    expect(stats.searches).toBeGreaterThan(0);
    expect(stats.settledNodes).toBeGreaterThan(0);
    expect(stats.maxSearchBoundM).toBeLessThanOrEqual(config.rail.maxRouteM);
    expect(stats.maxSearchHops).toBe(config.rail.maxHops);
    expect(stats.alignMs).toBeGreaterThan(0);
  });

  it("with the aligner off no stretch costs anything", () => {
    const plan = planWindow(walkTrainWalk(), [], off);
    const stats = noRailPassStats();
    for (const piece of piecesToMap(plan, plan.tiles)) {
      for (const mapping of mapPiece(plan, piece, worldMap(), undefined, off)) {
        expect(mapping.rail).toBeNull();
        addRailCost(stats, mapping.railCost);
      }
    }
    expect(stats).toEqual(noRailPassStats());
  });
});

describe("the per-pass cap on rail-only tiles", () => {
  const piece = (move: number, count: number) => {
    const tiles = new Set(Array.from({ length: count }, (_, index) => `14/${move}/${index}`));
    return { stretches: [{ move, from: 0, first: 0, last: 1, to: 1, tiles }], tiles };
  };

  it("reads pieces within the cap and defers the moves of the rest, which a later pass judges again", () => {
    const { reads, deferred } = planRailReads([piece(0, 300), piece(1, 300), piece(2, 100)], 512);
    expect(reads.map((read) => read.stretches[0]?.move)).toEqual([0, 2]);
    expect([...deferred]).toEqual([1]);
    expect(reads.reduce((sum, read) => sum + read.tiles.size, 0)).toBeLessThanOrEqual(512);
  });

  it("reads everything within the cap, and nothing is deferred", () => {
    const { reads, deferred } = planRailReads([piece(0, 256), piece(1, 256)], 512);
    expect(reads).toHaveLength(2);
    expect(deferred.size).toBe(0);
  });

  it("marks a deferred move no_map/deferred and leaves its recorded line", () => {
    const points = walkTrainWalk();
    const config = defaultProcessingConfig;
    const plan = planWindow(points, [], config);
    const deferred = new Set(plan.moves.map((_move, number) => number));
    const result = inferWindow(
      plan,
      [],
      {
        trips: [],
        overrides: [],
        mapping: false,
        available: new Set(),
        rail: { available: plan.tiles, stretches: [], waiting: false, deferred },
      },
      config,
    );
    expect(moves(result).length).toBeGreaterThan(0);
    for (const move of moves(result)) {
      expect(railPath(move)).toMatchObject({ status: "no_map", reason: "deferred", source: null });
    }
    expect(result.rail.every((place) => place === null)).toBe(true);
  });
});
