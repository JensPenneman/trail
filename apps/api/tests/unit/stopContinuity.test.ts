import { describe, expect, it } from "vitest";
import { averagePoints } from "../../src/processing/averagePoints";
import { detectStops } from "../../src/processing/detectStops";
import { keptPoints } from "../../src/processing/keptPoint";
import type { RawPoint, Span, VisitSpan } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { haversineM } from "../../src/tracks/haversine";
import { commuteDays, home, type Leg, rides } from "../support/commuteDays";
import { moves, processWorld } from "../support/processWorld";
import {
  overlaps,
  secondsCovered,
  stopsHoldingTravel,
  uncoveredPoints,
} from "../support/segmentChecks";
import {
  concat,
  lastT,
  random,
  stay,
  toLonLat,
  travel,
  type Vertex,
} from "../support/syntheticWorld";

/*
 * Stops end when the phone leaves, and nobody disappears (docs/architecture.md
 * §17.3): invariants over generated commuter days, the pattern that made
 * multi-day stops on production, and random walks and stays.
 */

const config = defaultProcessingConfig;

function cut(points: readonly RawPoint[], visits: readonly VisitSpan[]) {
  const kept = keptPoints(points, averagePoints(points, config.averaging));
  return { kept, spans: detectStops(kept, visits, config.stops) };
}

/** Everything a cut must satisfy, whatever the day was like. */
function expectSound(kept: ReturnType<typeof cut>["kept"], spans: readonly Span[]) {
  expect(stopsHoldingTravel(kept, spans, config.stops)).toEqual([]);
  expect(overlaps(spans)).toEqual([]);
  expect(uncoveredPoints(kept, spans, config.stops)).toEqual([]);
}

/** The share of a leg's time spent in moves, and the longest piece of it in a stop. */
function asTravelled(spans: readonly Span[], leg: Leg) {
  const seconds = leg.endT - leg.startT;
  let inStop = 0;
  for (const span of spans) {
    if (span.kind !== "stop") continue;
    inStop = Math.max(inStop, Math.min(leg.endT, span.endT) - Math.max(leg.startT, span.startT));
  }
  return { moving: secondsCovered(spans, "move", leg.startT, leg.endT) / seconds, inStop };
}

const longestStop = (spans: readonly Span[]) =>
  Math.max(
    0,
    ...spans.filter((span) => span.kind === "stop").map((span) => span.endT - span.startT),
  );

/** 14 October 2026, 05:00 UTC: 07:00 in Brussels, at home. */
const day14 = 1_792_818_000;

describe("commuter days", () => {
  const variants = [
    { name: "recorded densely, departures never reported", homeDepartures: false },
    { name: "recorded densely, departures reported the next morning", homeDepartures: true },
    {
      name: "recorded sparsely on the way and at work",
      homeDepartures: false,
      rideIntervalS: 30,
      trainIntervalS: 150,
      workIntervalS: 240,
    },
  ];
  for (const variant of variants) {
    it(`keep every ride and train a move, and no stop holding travel: ${variant.name}`, () => {
      const days = commuteDays({ startT: day14, days: 2, ...variant });
      const { kept, spans } = cut(days.points, days.visits);
      expectSound(kept, spans);
      for (const leg of rides(days.legs)) {
        const travelled = asTravelled(spans, leg);
        expect(travelled.moving, `${leg.kind} from ${leg.startT}`).toBeGreaterThan(0.9);
        // A halt of a minute and a half is part of the ride, not a stop.
        expect(travelled.inStop, `${leg.kind} from ${leg.startT}`).toBeLessThan(120);
      }
      // The nights and the work days are stops; none spans more than a night.
      for (const leg of days.legs.filter((part) => part.kind === "home" || part.kind === "work")) {
        const seconds = leg.endT - leg.startT;
        expect(secondsCovered(spans, "stop", leg.startT, leg.endT) / seconds).toBeGreaterThan(0.9);
      }
      // The longest is a night at home (13 and a half hours), never days.
      expect(longestStop(spans)).toBeLessThan(14 * 3600);
    });
  }

  it("calls the rides cycling and the trains train, with the map", () => {
    const days = commuteDays({ startT: day14, days: 1 });
    const result = processWorld(days.points, { visits: days.visits });
    for (const leg of rides(days.legs)) {
      // The mode the leg spent most of its time in.
      const time = new Map<string, number>();
      for (const move of moves(result)) {
        const overlap = Math.min(leg.endT, move.endT) - Math.max(leg.startT, move.startT);
        if (overlap > 0)
          time.set(
            move.modeInferred ?? "unknown",
            (time.get(move.modeInferred ?? "unknown") ?? 0) + overlap,
          );
      }
      const [mode] = [...time].sort((a, b) => b[1] - a[1])[0] ?? ["none"];
      expect(mode, `${leg.kind} from ${leg.startT}`).toBe(
        leg.kind === "bike" ? "cycling" : "train",
      );
    }
  });
});

describe("the pattern that made multi-day stops on production", () => {
  // 13 October 19:01:18 UTC: home, and iOS reported the arrival; the departure came the next
  // morning at 05:10:44 as a second report. Nights logged every second, the commute sparsely.
  const arrivedAt = Date.UTC(2026, 9, 13, 19, 1, 18) / 1000;
  const departedAt = Date.UTC(2026, 9, 14, 5, 10, 44) / 1000;
  const evening = stay(home, {
    startT: arrivedAt - 30,
    durationS: departedAt - 900 - arrivedAt,
    intervalS: 1,
    noiseM: 3,
    accuracy: 12,
  });
  const [lon, lat] = toLonLat(home[0] + 6, home[1] - 4);
  const arrival: VisitSpan = { arrivedAt, departedAt: null, lat, lon, accuracy: 14 };
  const departure: VisitSpan = { ...arrival, departedAt };
  const days = commuteDays({
    startT: departedAt - 900,
    days: 2,
    rideIntervalS: 60,
    trainIntervalS: 240,
    workIntervalS: 300,
    homeDepartures: true,
  });
  const points = concat(evening, days.points);

  it("ends the night at home when the phone leaves, with only the arrival known", () => {
    // What the window that started after the departure was given: the arrival alone.
    const window = points.filter((point) => point.t > departedAt);
    const { kept, spans } = cut(window, [arrival, ...days.visits]);
    expectSound(kept, spans);
    expect(longestStop(spans)).toBeLessThan(14 * 3600);
    for (const leg of rides(days.legs)) {
      expect(asTravelled(spans, leg).moving, `${leg.kind} from ${leg.startT}`).toBeGreaterThan(0.9);
    }
  });

  it("is the same with both reports, and with the merged visit", () => {
    const withBoth = cut(points, [arrival, departure, ...days.visits]);
    const merged = cut(points, [departure, ...days.visits]);
    expectSound(withBoth.kept, withBoth.spans);
    expect(withBoth.spans).toEqual(merged.spans);
    // The night's stop ends where the ride begins, not days later.
    const [night] = withBoth.spans;
    expect(night?.kind).toBe("stop");
    expect(night?.endT).toBeLessThanOrEqual(departedAt + 60);
    for (const leg of rides(days.legs)) {
      expect(
        asTravelled(withBoth.spans, leg).moving,
        `${leg.kind} from ${leg.startT}`,
      ).toBeGreaterThan(0.9);
    }
  });
});

/** A random history: stays (some under visits) and travel, with recording gaps now and then. */
function randomHistory(seed: number): { points: RawPoint[]; visits: VisitSpan[]; legs: Leg[] } {
  const next = random(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
  const parts: RawPoint[][] = [];
  const visits: VisitSpan[] = [];
  const legs: Leg[] = [];
  let t = day14;
  let at: Vertex = [0, 0];
  const legsCount = 3 + Math.floor(next() * 6);
  for (let leg = 0; leg < legsCount; leg += 1) {
    // A stay, perhaps under a visit (closed, open, or reported twice).
    const intervalS = pick([1, 1, 5, 20, 60, 180]);
    const noiseM = pick([2, 4, 10, 30]);
    const durationS = Math.max(4 * intervalS, Math.round(120 + next() * 4 * 3600));
    const here = stay(at, {
      startT: t,
      durationS,
      intervalS,
      noiseM,
      accuracy: noiseM < 10 ? 10 : 35,
      motion: pick([["stationary"], [], ["walking"]]),
      seed: seed * 97 + leg,
    });
    parts.push(here);
    legs.push({ kind: "home", startT: t, endT: lastT(here) });
    const [lon, lat] = toLonLat(at[0] + (next() - 0.5) * 40, at[1] + (next() - 0.5) * 40);
    const visit = pick(["none", "closed", "open", "twice", "spurious"]);
    const leaves = lastT(here) + Math.round(next() * 300);
    if (visit === "closed" || visit === "twice") {
      visits.push({
        arrivedAt: t + 30,
        departedAt: leaves,
        lat,
        lon,
        accuracy: pick([10, 50, 120]),
      });
    }
    if (visit === "open" || visit === "twice") {
      visits.push({ arrivedAt: t + 30, departedAt: null, lat, lon, accuracy: pick([10, 50, 120]) });
    }
    t = lastT(here) + intervalS;
    // Sometimes the recording pauses: the phone lies still, or it is carried elsewhere meanwhile.
    if (next() < 0.3) {
      t += Math.round(360 + next() * 5 * 3600);
      if (next() < 0.5) {
        at = [at[0] + (next() - 0.5) * 8000, at[1] + (next() - 0.5) * 8000];
        continue;
      }
    }
    // Travel: on foot, by bike, by car or by train, sampled densely or not.
    const speedMs = pick([1.4, 5, 14, 33]);
    const lengthM = speedMs * (300 + next() * 3600);
    const path: Vertex[] = [at];
    let heading = next() * 2 * Math.PI;
    for (let turn = 0; turn < 4; turn += 1) {
      heading += (next() - 0.5) * 1.5;
      const last = path.at(-1) ?? at;
      path.push([
        last[0] + (Math.cos(heading) * lengthM) / 4,
        last[1] + (Math.sin(heading) * lengthM) / 4,
      ]);
    }
    const sampled = travel(path, {
      startT: t,
      speedMs,
      intervalS: pick([1, 1, 5, 30, 120]),
      noiseM: pick([3, 8]),
      accuracy: 10,
      motion: speedMs < 2 ? ["walking"] : speedMs < 8 ? ["cycling"] : ["driving"],
      seed: seed * 131 + leg,
    });
    parts.push(sampled);
    legs.push({ kind: speedMs < 8 ? "bike" : "train", startT: t, endT: lastT(sampled) });
    if (visit === "spurious") {
      // iOS reports a visit now and then mid-journey.
      const middle = sampled[Math.floor(sampled.length / 2)];
      if (middle !== undefined) {
        visits.push({
          arrivedAt: middle.t - 60,
          departedAt: middle.t + 60,
          lat: middle.lat,
          lon: middle.lon,
          accuracy: 30,
        });
      }
    }
    at = path.at(-1) ?? at;
    t = lastT(sampled) + 1;
  }
  visits.sort((a, b) => a.arrivedAt - b.arrivedAt);
  return { points: concat(...parts), visits, legs };
}

describe("random walks and stays", () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    it(`never overlap, cover every point and keep travel out of stops (seed ${seed})`, () => {
      const history = randomHistory(seed);
      const { kept, spans } = cut(history.points, history.visits);
      expectSound(kept, spans);
      // A journey that goes somewhere is a move for most of its time.
      for (const leg of history.legs.filter((part) => part.kind !== "home")) {
        const seconds = leg.endT - leg.startT;
        const first = history.points.find((point) => point.t === leg.startT);
        const last = history.points.find((point) => point.t === leg.endT);
        if (first === undefined || last === undefined || seconds < 600) continue;
        if (haversineM(first, last) < 2000) continue;
        expect(
          secondsCovered(spans, "move", leg.startT, leg.endT) / seconds,
          `leg from ${leg.startT}`,
        ).toBeGreaterThan(0.8);
      }
    });
  }
});
