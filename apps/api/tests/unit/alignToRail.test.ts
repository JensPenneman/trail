import { describe, expect, it, vi } from "vitest";
import type { KeptPoint } from "../../src/processing/keptPoint";
import { LocalProjection } from "../../src/processing/localProjection";
import type { MapData } from "../../src/processing/mapData";
import type { RailPoint, RawPoint } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { alignToRail } from "../../src/processing/rail/alignToRail";
import { judgeRailPath } from "../../src/processing/rail/judgeRailPath";
import { railContext, trainNetwork } from "../../src/processing/rail/railNetwork";
import { WayIndex } from "../../src/processing/wayIndex";
import {
  parallelLine,
  pathToTerminus,
  railRide,
  railWorld,
  roadLine,
  trackA,
  trackB,
} from "../support/railWorld";
import {
  distanceToLine,
  subPath,
  toLonLat,
  toXY,
  travel,
  type Vertex,
} from "../support/syntheticWorld";

const config = defaultProcessingConfig.rail;

const kept = (raw: readonly RawPoint[]): KeptPoint[] =>
  raw.map((point, index) => ({
    index,
    t: point.t,
    lat: point.lat,
    lon: point.lon,
    speed: 0,
    accuracy: point.accuracy ?? 30,
    stationary: false,
    reportedSpeed: null,
    altitude: null,
    verticalAccuracy: null,
    motion: [],
  }));

function align(raw: readonly RawPoint[], map: MapData = railWorld(), rail: typeof config = config) {
  const points = kept(raw);
  const index = new WayIndex(map, LocalProjection.around(points));
  const context = railContext(index, trainNetwork);
  return { kept: points, ...alignToRail(points, context, rail) };
}

const railLines = (map: MapData = railWorld()): Vertex[][] =>
  map.ways
    .filter((way) => way.kind === "rail")
    .map((way) => way.geometry.map(([lon, lat]) => toXY({ lat, lon })));
const lines = railLines();
const distanceToRails = (lonLat: readonly [number, number]): number => {
  const vertex = toXY({ lon: lonLat[0], lat: lonLat[1] });
  return Math.min(...lines.map((line) => distanceToLine(vertex, line)));
};

/** Every place and every vertex of the shape between places, as `[lon, lat]`. */
const servedVertices = (points: readonly RailPoint[]): [number, number][] =>
  points.flatMap((point) => [
    ...(point.path ?? []).map(([lon, lat]) => [lon, lat] as [number, number]),
    ...(point.lat === null || point.lon === null
      ? []
      : [[point.lon, point.lat] as [number, number]]),
  ]);

const placedX = (point: RailPoint): number => toXY({ lat: point.lat ?? 0, lon: point.lon ?? 0 })[0];

const ids = (names: readonly string[], map: MapData = railWorld()): Set<number> =>
  new Set(
    map.ways.filter((way) => way.name !== null && names.includes(way.name)).map((way) => way.id),
  );

describe("alignToRail", () => {
  it("ends a dense ride on the line, every vertex within a metre of a rail way", () => {
    const aligned = align(
      railRide(pathToTerminus(11_000), { intervalS: 1, noiseM: 5, accuracy: 8, seed: 3 }),
    );
    expect(aligned.kept.length).toBeGreaterThan(400);
    expect(aligned.stats.runs).toBe(1);
    expect(aligned.points.every((point) => point.run === 0 && point.lat !== null)).toBe(true);
    for (const vertex of servedVertices(aligned.points)) {
      expect(distanceToRails(vertex)).toBeLessThan(1);
    }
    // The first point starts the line, the last one is placed too.
    expect(aligned.points[0]?.path).toBeNull();
    expect(aligned.points.at(-1)?.lat).not.toBeNull();
  });

  it("rides through the six-track station within a few metres of the tracks, crossing between them at the switches", () => {
    const aligned = align(
      railRide(subPath(trackA, 8500, 11_500), { intervalS: 1, noiseM: 5, accuracy: 8, seed: 3 }),
    );
    expect(aligned.stats.runs).toBe(1);
    expect(aligned.points.every((point) => point.run === 0 && (point.z ?? 9) < 3)).toBe(true);
    // Tracks 4.5 m apart: a hop to the neighbour that no switch allows is drawn straight, a few metres off.
    for (const vertex of servedVertices(aligned.points)) {
      expect(distanceToRails(vertex)).toBeLessThan(5);
    }
    const straight = aligned.points.filter((point) => point.bridgedLegM > 0);
    expect(straight.length).toBeLessThanOrEqual(4);
  });

  it("does the same for sparse rides, with the rails between points as shape", () => {
    for (const intervalS of [5, 60, 240, 600]) {
      const raw = railRide(subPath(trackA, 1000, 60_000), { intervalS, noiseM: 0, seed: 2 });
      const aligned = align(raw);
      expect(aligned.stats.runs).toBe(1);
      expect(aligned.points.every((point) => point.run === 0)).toBe(true);
      for (const vertex of servedVertices(aligned.points)) {
        expect(distanceToRails(vertex)).toBeLessThan(1);
      }
      if (intervalS >= 240) {
        // Minutes apart: the line between two points is the track's curve, not a cut.
        expect(
          aligned.points.filter((point) => (point.path?.length ?? 0) > 5).length,
        ).toBeGreaterThan(aligned.kept.length / 2);
      }
    }
  });

  it("never lets the road beside the line win, whichever side the noise leans", () => {
    // 30 m towards the road: the road (40 m south) is 10 m away, the rails 30 m.
    const raw = railRide(
      subPath(trackA, 1800, 5200).map(([x, y]) => [x, y - 30] as const),
      { intervalS: 5, accuracy: 30 },
    );
    const aligned = align(raw);
    expect(aligned.stats.runs).toBe(1);
    for (const vertex of servedVertices(aligned.points)) {
      expect(distanceToRails(vertex)).toBeLessThan(1);
      expect(
        Math.min(
          ...roadLine.map((v) =>
            Math.hypot(
              ...[
                toXY({ lon: vertex[0], lat: vertex[1] })[0] - v[0],
                toXY({ lon: vertex[0], lat: vertex[1] })[1] - v[1],
              ],
            ),
          ),
        ),
      ).toBeGreaterThan(30);
    }
  });

  it("takes the branch at the junction: at least 95 % of the steps on the right line at 40 m accuracy", () => {
    const map = railWorld();
    const mainWays = ids(["Line 1 up", "Line 1 down"], map);
    // The branch and the unnamed tracks of the terminus at its end.
    const branchWays = new Set([
      ...ids(["Branch"], map),
      ...map.ways
        .filter((way) => way.kind === "rail" && way.name === null && way.service === undefined)
        .map((way) => way.id),
    ]);
    const path = pathToTerminus(11_000);
    // An accuracy of 40 m is the radius of 68 % of the fixes: about 27 m per axis.
    const raw = railRide(path, { intervalS: 2, noiseM: 27, accuracy: 40, seed: 11 });
    const aligned = align(raw, map);
    let before = 0;
    let beforeRight = 0;
    let after = 0;
    let afterRight = 0;
    for (const [position, place] of aligned.points.entries()) {
      if (!place.step) continue;
      // The junction lies 4 km along the path; the first 300 m after it are ambiguous at this noise.
      const travelled = 30 * ((aligned.kept[position]?.t ?? 0) - (aligned.kept[0]?.t ?? 0));
      if (travelled < 4000 - 300) {
        before += 1;
        if (mainWays.has(place.wayId ?? 0)) beforeRight += 1;
      } else if (travelled > 4000 + 300) {
        after += 1;
        if (branchWays.has(place.wayId ?? 0)) afterRight += 1;
      }
    }
    expect(before).toBeGreaterThan(50);
    expect(after).toBeGreaterThan(50);
    expect(beforeRight / before).toBeGreaterThanOrEqual(0.95);
    expect(afterRight / after).toBeGreaterThanOrEqual(0.95);
  });

  it("keeps the nearer of two lines 150 m apart, and follows the second one when that is the train's", () => {
    const map = railWorld();
    const second = ids(["Second line"], map);
    const onMain = railRide(subPath(trackA, 11_000, 17_000), {
      intervalS: 5,
      noiseM: 15,
      accuracy: 15,
      seed: 4,
    });
    const main = align(onMain, map);
    expect(main.points.every((point) => !second.has(point.wayId ?? 0))).toBe(true);

    const viaSecond: Vertex[] = [
      ...subPath(trackA, 10_500, 11_500),
      ...parallelLine,
      ...subPath(trackA, 16_500, 17_500),
    ];
    const taken = align(
      railRide(viaSecond, { intervalS: 5, noiseM: 15, accuracy: 15, seed: 5 }),
      map,
    );
    const middle = taken.points.filter((point) => second.has(point.wayId ?? 0));
    expect(middle.length / taken.points.length).toBeGreaterThan(0.4);
    expect(taken.points.every((point) => point.run === 0)).toBe(true);
  });

  it("routes through a four-minute tunnel gap, along the S-bend", () => {
    const before = railRide(subPath(trackA, 27_000, 29_000), {
      intervalS: 2,
      startT: 1_800_000_000,
    });
    const after = railRide(subPath(trackA, 36_200, 38_000), {
      intervalS: 2,
      startT: 1_800_000_240 + 70,
    });
    const aligned = align([...before, ...after]);
    expect(aligned.points.every((point) => point.run === 0)).toBe(true);
    const joint = before.length;
    expect(aligned.kept[joint]?.t).toBeGreaterThan((aligned.kept[joint - 1]?.t ?? 0) + 200);
    expect(aligned.points[joint]?.routed).toBe(true);
    expect(aligned.points[joint]?.bridgedLegM).toBe(0);
    expect(aligned.points[joint]?.path?.length ?? 0).toBeGreaterThan(10);
    for (const vertex of servedVertices(aligned.points)) {
      expect(distanceToRails(vertex)).toBeLessThan(1);
    }
  });

  describe("a fix that jumps near another track and back", () => {
    /** The ride on the main line past the parallel line (12 to 16 km), the fixes at `at` shifted by `dy` metres. */
    const jumped = (at: readonly number[], dy: number) =>
      align(
        railRide(subPath(trackA, 11_000, 17_500), {
          intervalS: 5,
          noiseM: 3,
          accuracy: 15,
          seed: 9,
        }).map((point, index) => {
          if (!at.includes(index)) return point;
          const [x, y] = toXY({ lat: point.lat, lon: point.lon });
          const [lon, lat] = toLonLat(x, y + dy);
          return { ...point, lat, lon };
        }),
      );
    const mainTracks = [trackA, trackB] as Vertex[][];
    const distanceToMain = (lonLat: readonly [number, number]): number => {
      const vertex = toXY({ lon: lonLat[0], lat: lonLat[1] });
      return Math.min(...mainTracks.map((line) => distanceToLine(vertex, line)));
    };

    it("passes two fixes that jumped 150 m onto the second line as outliers, the line staying on the main tracks", () => {
      const aligned = jumped([20, 21], -150);
      expect(aligned.stats.runs).toBe(1);
      expect(aligned.points[20]?.outlier).toBe(true);
      expect(aligned.points[21]?.outlier).toBe(true);
      expect(aligned.points.filter((point) => point.outlier).length).toBe(2);
      for (const vertex of servedVertices(aligned.points)) {
        expect(distanceToMain(vertex)).toBeLessThan(1);
      }
      // Not even a short straight leg: the jump is no longer followed there and back.
      for (const point of aligned.points) expect(point.bridgedLegM).toBeLessThanOrEqual(4.5);
      expect(aligned.points.every((point) => !point.outlier || point.run === 0)).toBe(true);
    });

    it("counts the outliers the jump forced in the verdict's outlier share, and the part stays aligned", () => {
      const aligned = jumped([20, 21], -150);
      const verdict = judgeRailPath(
        aligned.kept,
        aligned.points,
        defaultProcessingConfig.rail.judge,
        "cache",
      );
      expect(verdict.outlierShare).toBeGreaterThan(0.005);
      expect(verdict.outlierShare).toBeLessThan(0.15);
      expect(verdict).toMatchObject({ status: "aligned", bridgedMaxSpeedMs: 0 });
    });

    it("passes a single fix that jumped as an outlier", () => {
      const aligned = jumped([20], -150);
      expect(aligned.points[20]?.outlier).toBe(true);
      expect(aligned.points.filter((point) => point.outlier).length).toBe(1);
      for (const point of aligned.points) expect(point.bridgedLegM).toBe(0);
    });

    it("may take a jump onto track B of the double track, 4.5 m away: it is within the noise", () => {
      const aligned = jumped([20, 21], 4.5);
      for (const vertex of servedVertices(aligned.points)) {
        expect(distanceToMain(vertex)).toBeLessThan(1);
      }
      for (const point of aligned.points) expect(point.bridgedLegM).toBe(0);
    });
  });

  it("passes a wrong jump of two points along the rails as outliers", () => {
    const raw = railRide(subPath(trackA, 20_000, 28_000), { intervalS: 5, noiseM: 3, seed: 6 }).map(
      (point, index) => {
        if (index !== 40 && index !== 41) return point;
        const [lon, lat] = toLonLat(
          ...(toXY({ lat: point.lat, lon: point.lon }).map((v, axis) =>
            axis === 1 ? v + 1500 : v,
          ) as [number, number]),
        );
        return { ...point, lat, lon };
      },
    );
    const aligned = align(raw);
    expect(aligned.stats.runs).toBe(1);
    expect(aligned.points.filter((point) => point.outlier).length).toBe(2);
    expect(aligned.points[40]?.outlier).toBe(true);
    expect(aligned.points[41]?.outlier).toBe(true);
    expect(aligned.points[39]?.outlier).toBe(false);
    expect(aligned.points.every((point) => point.run === 0)).toBe(true);
    for (const vertex of servedVertices(aligned.points)) {
      expect(distanceToRails(vertex)).toBeLessThan(1);
    }
    // Eastbound: nobody lies behind the point before.
    for (let position = 1; position < aligned.points.length; position += 1) {
      const here = aligned.points[position];
      const there = aligned.points[position - 1];
      if (here !== undefined && there !== undefined) {
        expect(placedX(here)).toBeGreaterThanOrEqual(placedX(there) - 1e-6);
      }
    }
  });

  it("routes a 25 km gap and bridges one beyond the route bound", () => {
    const withGap = (toX: number, gapM: number) => {
      const first = railRide(subPath(trackA, 1000, 1500), { intervalS: 5 });
      const second = railRide(subPath(trackA, toX, toX + 500), {
        intervalS: 5,
        startT: (first.at(-1)?.t ?? 0) + Math.round(gapM / 30),
      });
      return align([...first, ...second]);
    };
    const near = withGap(26_000, 24_500);
    const routed = near.points.find((point) => point.legM > 20_000);
    expect(routed?.routed).toBe(true);
    expect(routed?.bridgedLegM).toBe(0);
    expect(routed?.path?.length).toBeGreaterThan(20);

    const far = withGap(99_000, 97_500);
    const bridged = far.points.find((point) => point.legM > 90_000);
    expect(bridged?.routed).toBe(false);
    expect(bridged?.bridgedLegM).toBeGreaterThan(90_000);
    expect(bridged?.path).toBeNull();
    // Kept for tuning: the speed the straight leg implies (97.5 km in 3250 s).
    expect(bridged?.bridgedSpeedMs).toBeGreaterThan(29);
    expect(bridged?.bridgedSpeedMs).toBeLessThan(31);
    expect(near.points.every((point) => point.bridgedSpeedMs === 0)).toBe(true);
    expect(far.stats.runs).toBe(1);
  });

  it("prefers the main track to a siding beside it", () => {
    // 6 m south of the main track through the station, 3 m north of the siding at 9 m.
    const raw = railRide(
      subPath(trackA, 8500, 11_000).map(([x, y]) => [x, y - 6] as const),
      { intervalS: 2, accuracy: 15 },
    );
    const map = railWorld();
    const siding = map.ways.find((way) => way.service === "siding");
    const withPenalty = align(raw, map);
    const throughStation = withPenalty.points.filter((_, position) => {
      const x = toXY(withPenalty.kept[position] ?? { lat: 0, lon: 0 })[0];
      return x > 9500 && x < 10_200;
    });
    expect(throughStation.length).toBeGreaterThan(8);
    expect(throughStation.every((point) => point.wayId !== siding?.id)).toBe(true);
  });

  it("gives a walk far from every track no run and never builds the routing graph", () => {
    const walk = travel(
      [
        [-2000, 2500],
        [-1000, 2500],
      ],
      { startT: 1_800_000_000, speedMs: 1.4, intervalS: 5, noiseM: 4, accuracy: 10 },
    );
    const points = kept(walk);
    const context = railContext(
      new WayIndex(railWorld(), LocalProjection.around(points)),
      trainNetwork,
    );
    const graph = vi.spyOn(context, "graph");
    const aligned = alignToRail(points, context, config);
    expect(aligned.stats.runs).toBe(0);
    expect(aligned.stats.searches).toBe(0);
    expect(aligned.points.every((point) => point.lat === null && point.run === -1)).toBe(true);
    expect(graph).not.toHaveBeenCalled();
    // The points that entered the model are marked whether or not a run took them in, so the
    // judge sees a part of enough steps with no rail in reach: no_rail, not "too short".
    expect(aligned.stats.steps).toBeGreaterThan(3);
    expect(aligned.points.filter((point) => point.step).length).toBe(aligned.stats.steps);
    expect(
      judgeRailPath(points, aligned.points, defaultProcessingConfig.rail.judge, "cache"),
    ).toMatchObject({ status: "no_rail", reason: "no_rail", coveredShare: 0 });
  });

  it("gives the same answer whatever order the map data comes in", () => {
    const raw = railRide(pathToTerminus(9000), { intervalS: 3, noiseM: 25, accuracy: 25, seed: 8 });
    const map = railWorld();
    const shuffled: MapData = {
      ...map,
      ways: [...map.ways].sort((a, b) => ((a.id * 7919) % 101) - ((b.id * 7919) % 101)),
    };
    expect(shuffled.ways.map((way) => way.id)).not.toEqual(map.ways.map((way) => way.id));
    const first = align(raw, map);
    const second = align(raw, shuffled);
    expect(second.points).toEqual(first.points);
  });

  it("gives the places of the whole ride when a move is cut into stretches with a margin", () => {
    const raw = railRide(pathToTerminus(3000), { intervalS: 5, noiseM: 8, accuracy: 10, seed: 9 });
    const whole = align(raw);
    const cut = 60;
    const margin = 10; // points: 10 × 5 s × 30 m/s = 1.5 km, the seam margin
    const head = align(raw.slice(0, cut + margin));
    const tail = align(raw.slice(cut - margin));
    for (const [position, place] of whole.points.entries()) {
      const other = position < cut ? head.points[position] : tail.points[position - (cut - margin)];
      if (other === undefined) throw new Error("no place");
      expect(other.lat).not.toBeNull();
      const [x, y] = toXY({ lat: place.lat ?? 0, lon: place.lon ?? 0 });
      const [ox, oy] = toXY({ lat: other.lat ?? 0, lon: other.lon ?? 0 });
      expect(Math.hypot(x - ox, y - oy)).toBeLessThan(1);
    }
  });

  it("is made of the same measures as its stats say", () => {
    const aligned = align(railRide(subPath(trackA, 1000, 6000), { intervalS: 1 }));
    expect(aligned.stats.steps).toBe(aligned.points.filter((point) => point.step).length);
    expect(aligned.stats.steps).toBeLessThan(aligned.kept.length);
    expect(aligned.stats.searches).toBeGreaterThan(0);
    expect(aligned.stats.settledNodes).toBeGreaterThan(0);
  });
});
