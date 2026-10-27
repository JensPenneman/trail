import { type TransportMode, type WayKind, wayKinds } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import { extractFeatures } from "../../src/processing/extractFeatures";
import type { KeptPoint } from "../../src/processing/keptPoint";
import { moveSeries } from "../../src/processing/moveSeries";
import type { MappedPoint, RawPoint, WayShares } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { emptyShares, wayFamilyOf } from "../../src/processing/wayFamily";
import {
  bikeRide,
  busRide,
  denseDay,
  ferryCrossing,
  flight,
  morning,
  motorwayDrive,
  sparseTrain,
  tramRide,
  walkInTown,
  walkTrainWalk,
} from "../support/journeys";
import { moves, processWorld } from "../support/processWorld";
import { toLonLat } from "../support/syntheticWorld";

type KindShares = Record<WayKind, number>;

/** Every synthetic journey with the modes of its moves (transportInference.test.ts, the benchmark). */
const journeys: readonly [string, () => RawPoint[], readonly TransportMode[]][] = [
  ["a walk in town", walkInTown, ["walking"]],
  ["a drive on the motorway", motorwayDrive, ["car"]],
  ["a bus ride", busRide, ["bus"]],
  ["a bike ride", bikeRide, ["cycling"]],
  ["a sparse train", sparseTrain, ["train"]],
  ["walk, train, walk", walkTrainWalk, ["walking", "train", "walking"]],
  ["a tram ride", tramRide, ["tram"]],
  ["a ferry crossing", ferryCrossing, ["boat"]],
  ["a flight", flight, ["plane"]],
  ["a dense day", denseDay, ["walking", "train", "walking", "walking", "train", "walking"]],
];

/** The way kind shares of a journey's only move. */
function kindsOf(points: readonly RawPoint[]): KindShares {
  const found = moves(processWorld(points));
  expect(found).toHaveLength(1);
  const kinds = found[0]?.features["wayKinds"] as KindShares | null | undefined;
  if (kinds === null || kinds === undefined) throw new Error("no way kinds");
  return kinds;
}

describe("the distance shares by way kind", () => {
  it("put each journey on its way: motorway, cycleway, rails, water", () => {
    expect(kindsOf(motorwayDrive())).toMatchObject({ motorway: 1, trunk: 0 });
    expect(kindsOf(bikeRide())).toMatchObject({ cycleway: 1 });
    expect(kindsOf(sparseTrain())).toMatchObject({ rail: 1 });
    expect(kindsOf(ferryCrossing())).toMatchObject({ ferry: 1 });
    expect(kindsOf(tramRide())).toMatchObject({ tram: 1 });
  });

  it("keep a flight off the network", () => {
    expect(kindsOf(flight())).toMatchObject({ other: 1 });
  });

  it("split a walk in town between the streets and the park path", () => {
    const kinds = kindsOf(walkInTown());
    expect(kinds.residential).toBeGreaterThan(0.5);
    expect(kinds.footway).toBeGreaterThan(0.2);
    expect(kinds.residential + kinds.footway).toBeCloseTo(1, 2);
  });

  it("name every kind, add up to the whole and by family to the family shares, modes unchanged", () => {
    for (const [name, journey, modes] of journeys) {
      const found = moves(processWorld(journey()));
      // The new shares change nothing the modes are judged on.
      expect(
        found.map((move) => move.modeInferred),
        name,
      ).toEqual(modes);
      for (const move of found) {
        const kinds = move.features["wayKinds"] as KindShares;
        const ways = move.features["ways"] as WayShares;
        expect(Object.keys(kinds).sort(), name).toEqual([...wayKinds].sort());
        const total = Object.values(kinds).reduce((sum, share) => sum + share, 0);
        expect(total, name).toBeCloseTo(1, 2);
        const byFamily = emptyShares();
        for (const kind of wayKinds) byFamily[wayFamilyOf(kind)] += kinds[kind];
        for (const family of Object.keys(ways) as (keyof WayShares)[]) {
          expect(byFamily[family], `${name}: ${family}`).toBeCloseTo(ways[family], 2);
        }
      }
    }
  });

  it("are null without map data, like the family shares", () => {
    for (const [name, journey] of journeys) {
      for (const move of moves(processWorld(journey(), { withMap: false }))) {
        expect(move.features["ways"], name).toBeNull();
        expect(move.features["wayKinds"], name).toBeNull();
      }
    }
  });
});

describe("the distance shares by way kind of a hand-made move", () => {
  const config = defaultProcessingConfig.features;
  /** A kept point `x` metres east of the synthetic world's origin, a minute after the one before. */
  const kept = (index: number, x: number): KeptPoint => {
    const [lon, lat] = toLonLat(x, 0);
    return {
      index,
      t: morning + 60 * index,
      lat,
      lon,
      speed: 1.5,
      accuracy: 5,
      stationary: false,
      reportedSpeed: null,
      altitude: null,
      verticalAccuracy: null,
      motion: [],
    };
  };
  const mappedAt = (point: KeptPoint, wayKind: WayKind | null): MappedPoint => ({
    lat: point.lat,
    lon: point.lon,
    wayId: null,
    wayKind,
    snapM: 0,
    path: null,
  });
  const featuresOf = (points: readonly KeptPoint[], mapped: readonly MappedPoint[] | null) =>
    extractFeatures(
      moveSeries(points, mapped, null, config),
      { first: 0, last: points.length - 1, withEnds: true },
      [],
      config,
    );

  it("count a matched point without a way kind as other, as the family shares count it as none", () => {
    const points = [kept(0, 0), kept(1, 100), kept(2, 200)];
    // The first interval counts half towards each end, the second wholly towards the street.
    const features = featuresOf(
      points,
      points.map((point, position) => mappedAt(point, position === 0 ? null : "residential")),
    );
    expect(features.wayKinds).toMatchObject({ other: 0.25, residential: 0.75 });
    expect(features.ways).toMatchObject({ none: 0.25, road: 0.75 });
  });

  it("are all zero for a mapped move that covers no distance, and null for one not mapped", () => {
    const still = [kept(0, 0), kept(1, 0)];
    const features = featuresOf(
      still,
      still.map((point) => mappedAt(point, "footway")),
    );
    expect(features.ways).toEqual(emptyShares());
    expect(features.wayKinds).toEqual(Object.fromEntries(wayKinds.map((kind) => [kind, 0])));
    const unmapped = featuresOf(still, null);
    expect(unmapped.ways).toBeNull();
    expect(unmapped.wayKinds).toBeNull();
  });
});
