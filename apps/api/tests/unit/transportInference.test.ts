import { describe, expect, it } from "vitest";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { planWindow, runPipeline } from "../../src/processing/runPipeline";
import {
  bikeRide,
  busRide,
  denseDay,
  deskJitter,
  ferryCrossing,
  flight,
  motorwayDrive,
  sparseTrain,
  tramRide,
  walkInTown,
  walkTrainWalk,
} from "../support/journeys";
import { moves, processWorld, stops } from "../support/processWorld";
import {
  distanceToLine,
  pathLength,
  railLine,
  subPath,
  toXY,
  worldMap,
} from "../support/syntheticWorld";

/** The one move of a journey, which must have been found. */
function onlyMove(result: ReturnType<typeof processWorld>) {
  const found = moves(result);
  expect(found).toHaveLength(1);
  const [move] = found;
  if (move === undefined) throw new Error("no move");
  return move;
}

describe("transport modes in the synthetic world", () => {
  it("keeps a dense walk a single walk", () => {
    const move = onlyMove(processWorld(walkInTown()));
    expect(move.modeInferred).toBe("walking");
    expect(move.confidence).toBeGreaterThan(0.8);
  });

  it("calls a drive on the motorway a car", () => {
    const move = onlyMove(processWorld(motorwayDrive()));
    expect(move.modeInferred).toBe("car");
    expect(move.features["ways"]).toMatchObject({ motorway: 1 });
    expect(move.confidence).toBeGreaterThan(0.8);
  });

  it("tells a bus by its stops at bus stops", () => {
    const move = onlyMove(processWorld(busRide()));
    expect(move.modeInferred).toBe("bus");
    // It paused at all seven stops it passed.
    expect(move.features["dwells"]).toMatchObject({ busStop: 7 });
    expect(move.features["passed"]).toMatchObject({ busStop: 7 });
    expect(move.confidence).toBeGreaterThan(0.6);
  });

  it("calls a ride on the cycleway cycling, with or without CoreMotion", () => {
    expect(onlyMove(processWorld(bikeRide())).modeInferred).toBe("cycling");
    const unreported = onlyMove(processWorld(bikeRide(undefined, { motion: [] })));
    expect(unreported.modeInferred).toBe("cycling");
    expect(unreported.features["near"]).toMatchObject({ cycleway: 1 });
  });

  it("calls the tram a tram: on its tracks, pausing at its stops", () => {
    const move = onlyMove(processWorld(tramRide()));
    expect(move.modeInferred).toBe("tram");
    expect(move.confidence).toBeGreaterThan(0.6);
  });

  it("puts the ferry crossing on the water", () => {
    const move = onlyMove(processWorld(ferryCrossing()));
    expect(move.modeInferred).toBe("boat");
    expect(move.features["ways"]).toMatchObject({ ferry: 1 });
  });

  it("recognises a flight by its speed and altitude", () => {
    const move = onlyMove(processWorld(flight()));
    expect(move.modeInferred).toBe("plane");
  });

  it("collapses half an hour of jitter on a desk into one stop", () => {
    const result = processWorld(deskJitter());
    expect(moves(result)).toHaveLength(0);
    expect(stops(result)).toHaveLength(1);
    const positions = new Set(result.averaged.map((point) => `${point.lat},${point.lon}`));
    expect(positions.size).toBe(1);
  });
});

describe("a train recorded every 3 to 5 minutes", () => {
  const points = sparseTrain();
  const result = processWorld(points);

  it("is one move between two stops at the stations, labelled train", () => {
    expect(result.segments.map((segment) => segment.kind)).toEqual(["stop", "move", "stop"]);
    const move = onlyMove(result);
    expect(move.modeInferred).toBe("train");
    expect(move.confidence).toBeGreaterThan(0.8);
    expect(move.features["ends"]).toMatchObject({ station: 2 });
  });

  it("is mapped along the rails, curves included", () => {
    const move = onlyMove(result);
    const line: [number, number][] = [];
    for (let index = move.first; index <= move.last; index += 1) {
      const kept = result.mapped.filter((_, raw) => result.averaged[raw]?.kept === true)[index];
      expect(kept?.wayKind).toBe("rail");
      for (const [lon, lat] of kept?.path ?? []) line.push(toXY({ lat, lon }));
      if (kept?.lat !== null && kept?.lat !== undefined && kept.lon !== null)
        line.push(toXY({ lat: kept.lat, lon: kept.lon }));
    }
    // Every vertex of the mapped line lies on the railway…
    for (const vertex of line) expect(distanceToLine(vertex, railLine)).toBeLessThan(1);
    // …and the line is as long as the railway between the stations, not the straight cuts.
    const along = pathLength(line);
    const rails = pathLength(subPath(railLine, 0, pathLength(railLine)));
    expect(along / rails).toBeGreaterThan(0.97);
    expect(move.distanceM / rails).toBeGreaterThan(0.97);
    // Straight lines between the points would cut across the fields, hundreds of metres off.
    let furthest = 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      if (a === undefined || b === undefined) continue;
      const [ax, ay] = toXY(a);
      const [bx, by] = toXY(b);
      furthest = Math.max(furthest, distanceToLine([(ax + bx) / 2, (ay + by) / 2], railLine));
    }
    expect(furthest).toBeGreaterThan(150);
    expect(line.length).toBeGreaterThan(5 * (move.last - move.first + 1));
  });

  it("still looks like a train without map data, but not certain", () => {
    const unmapped = onlyMove(processWorld(points, { withMap: false }));
    expect(unmapped.features["ways"]).toBeNull();
    expect(["car", "train", "unknown"]).toContain(unmapped.modeInferred);
    expect(unmapped.confidence ?? 1).toBeLessThan(0.8);
  });
});

describe("splitting a move where the mode changes", () => {
  it("cuts walk → train → walk into three", () => {
    const result = processWorld(walkTrainWalk());
    expect(stops(result)).toHaveLength(0);
    expect(moves(result).map((move) => move.modeInferred)).toEqual(["walking", "train", "walking"]);
    const [walk, train, walkAgain] = moves(result);
    // The parts share their boundary points: no gap in the timeline.
    expect(walk?.endT).toBe(train?.startT);
    expect(train?.endT).toBe(walkAgain?.startT);
  });
});

describe("determinism", () => {
  it("gives the same output for the same input, whatever order the map data comes in", () => {
    const points = denseDay();
    const config = defaultProcessingConfig;
    const available = planWindow(points, [], config).tiles;
    const run = (reversed: boolean) => {
      const map = worldMap();
      const ways = reversed ? [...map.ways].reverse() : map.ways;
      const pois = reversed ? [...map.pois].reverse() : map.pois;
      return JSON.stringify(
        runPipeline(
          points,
          [],
          { trips: [], overrides: [], map: { ways, pois }, available },
          config,
        ),
      );
    };
    const first = run(false);
    expect(run(false)).toBe(first);
    expect(run(true)).toBe(first);
  });
});
