import { describe, expect, it } from "vitest";
import { averagePoints } from "../../src/processing/averagePoints";
import { detectStops } from "../../src/processing/detectStops";
import { keptPoints } from "../../src/processing/keptPoint";
import type { RawPoint, VisitSpan } from "../../src/processing/pipelineTypes";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { morning, walkInTown } from "../support/journeys";
import { stopsHoldingTravel, uncoveredPoints } from "../support/segmentChecks";
import { concat, lastT, stay, toLonLat, travel } from "../support/syntheticWorld";

const kept = (points: readonly RawPoint[]) =>
  keptPoints(points, averagePoints(points, defaultProcessingConfig.averaging));

const spansOf = (points: readonly RawPoint[], visits: readonly VisitSpan[] = []) =>
  detectStops(kept(points), visits, defaultProcessingConfig.stops).map((span) => ({
    kind: span.kind,
    from: span.startT - morning,
    to: span.endT - morning,
  }));

const visitAt = (x: number, y: number, arrivedAt: number, departedAt: number | null): VisitSpan => {
  const [lon, lat] = toLonLat(x, y);
  return { arrivedAt, departedAt, lat, lon, accuracy: 20 };
};

const street = [
  [0, -2000],
  [2000, -2000],
] as const;

describe("detectStops", () => {
  it("finds a stay of three minutes or more, and nothing in a walk", () => {
    expect(spansOf(walkInTown()).map((span) => span.kind)).toEqual(["move"]);
    const walk = travel(street, {
      startT: morning,
      speedMs: 1.4,
      intervalS: 1,
      motion: ["walking"],
    });
    const shop = stay([2000, -2000], { startT: lastT(walk) + 1, durationS: 600, intervalS: 5 });
    const back = travel([...street].reverse(), {
      startT: lastT(shop) + 1,
      speedMs: 1.4,
      intervalS: 1,
      motion: ["walking"],
    });
    expect(spansOf(concat(walk, shop, back)).map((span) => span.kind)).toEqual([
      "move",
      "stop",
      "move",
    ]);
  });

  it("does not stop for a short wait", () => {
    const walk = travel(street, { startT: morning, speedMs: 1.4, intervalS: 1 });
    const wait = stay([2000, -2000], { startT: lastT(walk) + 1, durationS: 150, intervalS: 5 });
    const on = travel(
      [
        [2000, -2000],
        [4000, -2000],
      ],
      { startT: lastT(wait) + 1, speedMs: 1.4, intervalS: 1 },
    );
    expect(spansOf(concat(walk, wait, on)).map((span) => span.kind)).toEqual(["move"]);
  });

  it("shares the boundary points: moves start where stops end", () => {
    const home = stay([0, -2000], { startT: morning, durationS: 900, intervalS: 10 });
    const walk = travel(street, { startT: lastT(home) + 10, speedMs: 1.4, intervalS: 1 });
    const spans = spansOf(concat(home, walk));
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move"]);
    expect(spans[0]?.to).toBe(spans[1]?.from);
  });

  it("keeps the stop through a recording pause that resumes nearby", () => {
    // iOS pauses after ten minutes still, and resumes outside its 100 m geofence hours later.
    const home = stay([0, -2000], { startT: morning, durationS: 600, intervalS: 10 });
    const resumedAt = lastT(home) + 3 * 3600;
    const walk = travel(
      [
        [100, -2000],
        [2000, -2000],
      ],
      { startT: resumedAt, speedMs: 1.4, intervalS: 1 },
    );
    const spans = spansOf(concat(home, walk));
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move"]);
    expect(spans[0]?.to).toBe(resumedAt - morning);
    expect(spans[1]?.from).toBe(resumedAt - morning);
  });

  it("turns a recording gap the phone lay still through into a stop until it woke up", () => {
    // The phone died at 08:10 and came back 100 m on in the evening: it lay there all along.
    const walk = travel(street, { startT: morning, speedMs: 1.4, intervalS: 1 });
    const later = travel(
      [
        [2100, -2000],
        [3000, -2000],
      ],
      { startT: lastT(walk) + 8 * 3600, speedMs: 1.4, intervalS: 1 },
    );
    const spans = spansOf(concat(walk, later));
    expect(spans.map((span) => span.kind)).toEqual(["move", "stop", "move"]);
    // The day stays covered: the stop spans the gap, from where the phone lay to where it woke.
    expect(spans[1]).toEqual({
      kind: "stop",
      from: lastT(walk) - morning,
      to: lastT(walk) + 8 * 3600 - morning,
    });
    expect(spans[0]?.to).toBe(spans[1]?.from);
    expect(spans[1]?.to).toBe(spans[2]?.from);
    // The point it woke up at is the move's: the stop is the point it lay at.
    const points = kept(concat(walk, later));
    const [, stop, after] = detectStops(points, [], defaultProcessingConfig.stops);
    expect(points[stop?.last ?? -1]?.t).toBe(lastT(walk));
    expect(after?.first).toBe((stop?.last ?? 0) + 1);
  });

  it("leaves a gap with travel out of every segment", () => {
    // The phone died at 08:10 and came back 5 km away in the evening.
    const walk = travel(street, { startT: morning, speedMs: 1.4, intervalS: 1 });
    const later = travel(
      [
        [7000, -2000],
        [8000, -2000],
      ],
      { startT: lastT(walk) + 8 * 3600, speedMs: 1.4, intervalS: 1 },
    );
    const spans = spansOf(concat(walk, later));
    expect(spans.map((span) => span.kind)).toEqual(["move", "move"]);
    expect((spans[1]?.from ?? 0) - (spans[0]?.to ?? 0)).toBeGreaterThan(7 * 3600);
  });

  it("keeps a fast gap inside the move (a flight, a tunnel)", () => {
    const before = travel(
      [
        [0, 0],
        [3000, 0],
      ],
      { startT: morning, speedMs: 30, intervalS: 1 },
    );
    const after = travel(
      [
        [100_000, 0],
        [103_000, 0],
      ],
      { startT: lastT(before) + 3200, speedMs: 30, intervalS: 1 },
    );
    expect(spansOf(concat(before, after)).map((span) => span.kind)).toEqual(["move"]);
  });

  it("turns an iOS visit into a stop even where GPS drifts", () => {
    // Indoors the fixes wander 80 m around; iOS reported the visit.
    const drifting = stay([0, -2000], {
      startT: morning,
      durationS: 900,
      intervalS: 5,
      noiseM: 45,
      accuracy: 40,
    });
    const [lon, lat] = toLonLat(0, -2000);
    const visit: VisitSpan = {
      arrivedAt: morning,
      departedAt: morning + 900,
      lat,
      lon,
      accuracy: 50,
    };
    const withVisit = spansOf(drifting, [visit]);
    expect(withVisit.map((span) => span.kind)).toEqual(["stop"]);
  });

  it("stops where CoreMotion says stationary throughout", () => {
    const drifting = stay([0, -2000], {
      startT: morning,
      durationS: 900,
      intervalS: 5,
      noiseM: 45,
      accuracy: 40,
      motion: ["stationary"],
    });
    expect(spansOf(drifting).map((span) => span.kind)).toEqual(["stop"]);
  });

  it("ends an open visit when the phone leaves, never at the end of the window", () => {
    // Home overnight (iOS reported the arrival, never the departure), then off by bike to work.
    const night = stay([0, -2000], {
      startT: morning - 10 * 3600,
      durationS: 10 * 3600,
      intervalS: 1,
    });
    const ride = travel(
      [
        [0, -2000],
        [6000, -2000],
      ],
      { startT: lastT(night) + 1, speedMs: 5, intervalS: 1, motion: ["cycling"] },
    );
    const work = stay([6000, -2000], {
      startT: lastT(ride) + 1,
      durationS: 8 * 3600,
      intervalS: 30,
    });
    const spans = spansOf(concat(night, ride, work), [
      visitAt(0, -2000, morning - 10 * 3600, null),
    ]);
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move", "stop"]);
    // The stop at home ends as the ride begins, not with the window hours later.
    expect(spans[0]?.to).toBeLessThanOrEqual(lastT(night) + 1 - morning);
    expect(spans[1]?.to).toBeGreaterThanOrEqual(lastT(ride) - 5 - morning);
  });

  it("gives a visit known to have ended a stop for each time the phone was there", () => {
    // At the office under one visit, with half an hour out for lunch 600 m away.
    const morningAt = stay([0, -2000], {
      startT: morning,
      durationS: 3 * 3600,
      intervalS: 60,
      noiseM: 30,
      accuracy: 40,
    });
    const out = travel(
      [
        [0, -2000],
        [0, -1400],
      ],
      { startT: lastT(morningAt) + 60, speedMs: 1.3, intervalS: 5, motion: ["walking"] },
    );
    const lunch = stay([0, -1400], {
      startT: lastT(out) + 5,
      durationS: 900,
      intervalS: 30,
      accuracy: 15,
    });
    const back = travel(
      [
        [0, -1400],
        [0, -2000],
      ],
      { startT: lastT(lunch) + 5, speedMs: 1.3, intervalS: 5, motion: ["walking"] },
    );
    const afternoon = stay([0, -2000], {
      startT: lastT(back) + 60,
      durationS: 3 * 3600,
      intervalS: 60,
      noiseM: 30,
      accuracy: 40,
    });
    const visit = visitAt(0, -2000, morning, lastT(afternoon) + 60);
    const spans = spansOf(concat(morningAt, out, lunch, back, afternoon), [visit]);
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move", "stop", "move", "stop"]);
    expect(spans[0]?.to).toBeLessThan(lastT(morningAt) + 60 - morning);
    expect(spans[4]?.from).toBeGreaterThan(lastT(back) - morning);
  });

  it("keeps a visit one stop through a short excursion", () => {
    // Three minutes out to the car 200 m away, then back in.
    const before = stay([0, -2000], {
      startT: morning,
      durationS: 1800,
      intervalS: 20,
      noiseM: 25,
      accuracy: 30,
    });
    const out = travel(
      [
        [0, -2000],
        [200, -2000],
        [0, -2000],
      ],
      { startT: lastT(before) + 20, speedMs: 2.5, intervalS: 10, motion: ["walking"] },
    );
    const after = stay([0, -2000], {
      startT: lastT(out) + 20,
      durationS: 1800,
      intervalS: 20,
      noiseM: 25,
      accuracy: 30,
    });
    const visit = visitAt(0, -2000, morning, lastT(after) + 30);
    expect(spansOf(concat(before, out, after), [visit]).map((span) => span.kind)).toEqual(["stop"]);
  });

  it("leaves the walk to the door out of a visit's stop", () => {
    // Parked 120 m away and walked to the house; iOS dates the arrival to the car's last minute.
    const drive = travel(
      [
        [-2000, -2000],
        [-120, -2000],
      ],
      { startT: morning, speedMs: 12, intervalS: 1, motion: ["driving"] },
    );
    const walk = travel(
      [
        [-120, -2000],
        [0, -2000],
      ],
      { startT: lastT(drive) + 1, speedMs: 1.3, intervalS: 1, motion: ["walking"] },
    );
    const inside = stay([0, -2000], { startT: lastT(walk) + 1, durationS: 3600, intervalS: 10 });
    const spans = spansOf(concat(drive, walk, inside), [
      visitAt(0, -2000, lastT(drive) - 60, null),
    ]);
    expect(spans.map((span) => span.kind)).toEqual(["move", "stop"]);
    expect(spans[1]?.from).toBeGreaterThanOrEqual(lastT(walk) - 2 - morning);
  });

  it("ignores a visit iOS reports at a train's halt", () => {
    const ride = travel(
      [
        [0, 0],
        [20_000, 0],
      ],
      {
        startT: morning,
        speedMs: 30,
        intervalS: 5,
        motion: ["driving"],
        pauses: [{ atM: 10_000, seconds: 100 }],
      },
    );
    const halt = morning + Math.round(10_000 / 30);
    expect(
      spansOf(ride, [visitAt(10_000, 0, halt - 30, halt + 130)]).map((span) => span.kind),
    ).toEqual(["move"]);
  });

  it("does not let a visit's stop hold travel", () => {
    // iOS put the visit between two places 400 m apart, both within its (bad) accuracy.
    const atA = stay([-200, -2000], { startT: morning, durationS: 3600, intervalS: 10 });
    const toB = travel(
      [
        [-200, -2000],
        [200, -2000],
      ],
      { startT: lastT(atA) + 10, speedMs: 1.3, intervalS: 10, motion: ["walking"] },
    );
    const atB = stay([200, -2000], { startT: lastT(toB) + 10, durationS: 1200, intervalS: 10 });
    const back = travel(
      [
        [200, -2000],
        [-200, -2000],
      ],
      { startT: lastT(atB) + 10, speedMs: 1.3, intervalS: 10, motion: ["walking"] },
    );
    const again = stay([-200, -2000], { startT: lastT(back) + 10, durationS: 3600, intervalS: 10 });
    const [lon, lat] = toLonLat(0, -2000);
    const visit: VisitSpan = {
      arrivedAt: morning,
      departedAt: lastT(again) + 10,
      lat,
      lon,
      accuracy: 400,
    };
    const points = concat(atA, toB, atB, back, again);
    const spans = detectStops(kept(points), [visit], defaultProcessingConfig.stops);
    expect(stopsHoldingTravel(kept(points), spans, defaultProcessingConfig.stops)).toEqual([]);
    // Three stays, A, B and A again, with the walks between them as moves: B is no move.
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move", "stop", "move", "stop"]);
    const [, , atBStop] = spans;
    expect(atBStop?.startT).toBeGreaterThanOrEqual(lastT(toB) - 20);
    expect(atBStop?.endT).toBeLessThanOrEqual(lastT(atB) + 20);
  });

  it("keeps a stay apart that overlapping visits chained to another place", () => {
    // Three visits in a row 250 m apart, each reported to overlap the next: three stays.
    const places = [-250, 0, 250];
    const legs = places.flatMap((x, index) => {
      const startT = morning + index * 2 * 3600;
      return [
        stay([x, -2000], { startT, durationS: 3600 + 600, intervalS: 10, seed: 70 + index }),
        travel(
          [
            [x, -2000],
            [x + 250, -2000],
          ],
          { startT: startT + 4210, speedMs: 1.3, intervalS: 10, motion: ["walking"] },
        ),
      ];
    });
    const points = concat(...legs.slice(0, -1));
    const visits = places.map((x, index): VisitSpan => {
      const [lon, lat] = toLonLat(x, -2000);
      const arrivedAt = morning + index * 2 * 3600;
      return { arrivedAt, departedAt: arrivedAt + 2 * 3600 + 900, lat, lon, accuracy: 120 };
    });
    const spans = detectStops(kept(points), visits, defaultProcessingConfig.stops);
    expect(stopsHoldingTravel(kept(points), spans, defaultProcessingConfig.stops)).toEqual([]);
    // Every stay of an hour and more is a stop for most of its time.
    for (const index of [0, 1, 2]) {
      const from = morning + index * 2 * 3600;
      let still = 0;
      for (const span of spans) {
        if (span.kind !== "stop") continue;
        still += Math.max(0, Math.min(from + 4200, span.endT) - Math.max(from, span.startT));
      }
      expect(still / 4200, `stay ${index}`).toBeGreaterThan(0.9);
    }
  });

  it("splits a stay at a real walk even within a dwell's radius", () => {
    // Four minutes at the bike shed, 45 m on foot, five minutes on the platform: one dwell's radius.
    const shed = stay([0, -2000], { startT: morning, durationS: 240, intervalS: 1, noiseM: 2 });
    const walk = travel(
      [
        [0, -2000],
        [45, -2000],
      ],
      { startT: lastT(shed) + 1, speedMs: 1.3, intervalS: 1, motion: ["walking"] },
    );
    const platform = stay([45, -2000], {
      startT: lastT(walk) + 1,
      durationS: 300,
      intervalS: 1,
      noiseM: 2,
    });
    const spans = spansOf(concat(shed, walk, platform));
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move", "stop"]);
    expect(spans[1]?.to).toBeLessThanOrEqual(lastT(walk) - morning + 2);
  });

  it("gives the stop a point recorded just after it when no move can start there", () => {
    // Under a visit until 5 s after the last point, one more point 10 s on, then the phone
    // sleeps and wakes up 3 km away two hours later.
    const atHome = stay([0, -2000], { startT: morning, durationS: 3600, intervalS: 10 });
    const after = stay([5, -2000], { startT: lastT(atHome) + 10, durationS: 0, intervalS: 10 });
    const later = travel(
      [
        [3000, -2000],
        [4000, -2000],
      ],
      { startT: lastT(atHome) + 3610, speedMs: 1.4, intervalS: 5, motion: ["walking"] },
    );
    const visit = visitAt(0, -2000, morning, lastT(atHome) + 5);
    const points = concat(atHome, after, later);
    const spans = detectStops(kept(points), [visit], defaultProcessingConfig.stops);
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move"]);
    expect(uncoveredPoints(kept(points), spans, defaultProcessingConfig.stops)).toEqual([]);
    expect(spans[0]?.endT).toBe(lastT(after));
  });

  it("ends a visit whose departure never came at the next visit's arrival", () => {
    // At home under a visit iOS never reported leaving, three minutes on foot, then an hour next
    // door, 200 m on: within the open visit's (wide) radius, but the next visit says it was over.
    const atHome = stay([0, -2000], { startT: morning, durationS: 3600, intervalS: 10 });
    const walk = travel(
      [
        [0, -2000],
        [0, -1800],
      ],
      { startT: lastT(atHome) + 5, speedMs: 1.1, intervalS: 5, motion: ["walking"] },
    );
    const nextDoor = stay([0, -1800], { startT: lastT(walk) + 5, durationS: 3600, intervalS: 10 });
    const points = concat(atHome, walk, nextDoor);
    const [lon, lat] = toLonLat(0, -2000);
    const home: VisitSpan = {
      arrivedAt: morning,
      departedAt: null,
      endsBy: lastT(walk) - 30,
      lat,
      lon,
      accuracy: 300,
    };
    const spans = detectStops(kept(points), [home], defaultProcessingConfig.stops);
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move", "stop"]);
    expect(spans[0]?.endT).toBeLessThanOrEqual(lastT(atHome) + 5);
    // Without the next arrival the open visit takes in the walk and the hour next door.
    const unbounded = detectStops(
      kept(points),
      [{ ...home, endsBy: null }],
      defaultProcessingConfig.stops,
    );
    expect(unbounded.map((span) => span.kind)).toEqual(["stop"]);
  });

  it("does not join two stays with a real walk between them: the transfer is a move", () => {
    // Four minutes at the bike shed, 70 m on foot, six minutes on the platform.
    const shed = stay([0, -2000], { startT: morning, durationS: 240, intervalS: 1, noiseM: 3 });
    const walk = travel(
      [
        [0, -2000],
        [70, -2000],
      ],
      { startT: lastT(shed) + 1, speedMs: 1.4, intervalS: 1, motion: ["walking"] },
    );
    const platform = stay([70, -2000], {
      startT: lastT(walk) + 1,
      durationS: 360,
      intervalS: 1,
      noiseM: 3,
    });
    const spans = spansOf(concat(shed, walk, platform));
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move", "stop"]);
    // The walk is the move: from the shed's last still point to the platform's first.
    expect(spans[1]?.from).toBeGreaterThanOrEqual(lastT(shed) - morning - 1);
    expect(spans[1]?.to).toBeLessThanOrEqual(lastT(walk) - morning + 1);
  });

  it("still joins two stays when only GPS drifted between them", () => {
    // Indoors the fix jumps about for two minutes; the phone reads itself as still.
    const first = stay([0, -2000], { startT: morning, durationS: 600, intervalS: 2, noiseM: 3 });
    const drift = [
      [90, -2000],
      [-20, -1910],
      [100, -1990],
      [60, -1920],
      [95, -2040],
      [-30, -1930],
    ].flatMap(([x = 0, y = 0], index) =>
      stay([x, y], {
        startT: lastT(first) + 2 + index * 20,
        durationS: 10,
        intervalS: 5,
        noiseM: 2,
        seed: 40 + index,
      }),
    );
    const second = stay([50, -1990], {
      startT: lastT(first) + 130,
      durationS: 600,
      intervalS: 2,
      noiseM: 3,
    });
    expect(spansOf(concat(first, drift, second)).map((span) => span.kind)).toEqual(["stop"]);
  });

  it("joins two stops a short, slow wander apart", () => {
    // Shuffling across the room at less than walking pace is no walk.
    const first = stay([0, -2000], { startT: morning, durationS: 600, intervalS: 5, noiseM: 3 });
    const wander = travel(
      [
        [0, -2000],
        [45, -2000],
        [50, -1990],
      ],
      { startT: lastT(first) + 5, speedMs: 0.4, intervalS: 2 },
    );
    const second = stay([50, -1990], {
      startT: lastT(wander) + 5,
      durationS: 600,
      intervalS: 5,
      noiseM: 3,
    });
    expect(spansOf(concat(first, wander, second)).map((span) => span.kind)).toEqual(["stop"]);
  });

  for (const intervalS of [2, 20, 60]) {
    it(`does not split a stay at one CoreMotion walking reading as the fix jumps, a point every ${intervalS} s`, () => {
      // Half an hour, one fix 70 m off read as walking, half an hour more.
      const first = stay([0, -2000], {
        startT: morning,
        durationS: 1800,
        intervalS,
        noiseM: 3,
        motion: [],
      });
      const [lon, lat] = toLonLat(70, -2000);
      const jump: RawPoint = {
        t: lastT(first) + intervalS,
        lat,
        lon,
        accuracy: 30,
        speed: null,
        altitude: null,
        verticalAccuracy: null,
        motion: ["walking"],
      };
      const second = stay([0, -2000], {
        startT: jump.t + intervalS,
        durationS: 1800,
        intervalS,
        noiseM: 3,
        motion: [],
        seed: 9,
      });
      expect(spansOf(concat(first, [jump], second)).map((span) => span.kind)).toEqual(["stop"]);
    });
  }

  it("joins two stays one fix apart with a point every three minutes", () => {
    // One fix 100 m off between two at home: no excursion of six minutes.
    const before = stay([0, -2000], { startT: morning, durationS: 3600, intervalS: 180 });
    const [lon, lat] = toLonLat(100, -2000);
    const off: RawPoint = {
      t: lastT(before) + 180,
      lat,
      lon,
      accuracy: 30,
      speed: null,
      altitude: null,
      verticalAccuracy: null,
      motion: [],
    };
    const after = stay([0, -2000], { startT: off.t + 180, durationS: 3600, intervalS: 180 });
    expect(spansOf(concat(before, [off], after)).map((span) => span.kind)).toEqual(["stop"]);
  });

  it("joins two stays without a visit across one fix far off, unless sparse and far", () => {
    // An hour at home, one fix `offM` east, an hour more: no visit to vouch for the stay.
    const across = (intervalS: number, offM: number) => {
      const before = stay([0, -2000], { startT: morning, durationS: 3600, intervalS, motion: [] });
      const [lon, lat] = toLonLat(offM, -2000);
      const off: RawPoint = {
        t: lastT(before) + intervalS,
        lat,
        lon,
        accuracy: 65,
        speed: null,
        altitude: null,
        verticalAccuracy: null,
        motion: [],
      };
      const after = stay([0, -2000], {
        startT: off.t + intervalS,
        durationS: 3600,
        intervalS,
        motion: [],
        seed: 6,
      });
      return spansOf(concat(before, [off], after)).map((span) => span.kind);
    };
    expect(across(10, 350)).toEqual(["stop"]);
    expect(across(60, 450)).toEqual(["stop"]);
    // A point every ten minutes: one fix 200 m off is GPS jumping about, one 400 m off may be a
    // walk there and back.
    expect(across(600, 200)).toEqual(["stop"]);
    expect(across(600, 400)).toEqual(["stop", "move", "stop"]);
  });

  for (const intervalS of [2, 60]) {
    it(`keeps a ride to a shop 400 m away apart from home, without speed readings, a point every ${intervalS} s`, () => {
      // Half an hour at home, by bike to the shop and back with 40 s there, half an hour more.
      const before = stay([0, -2000], {
        startT: morning,
        durationS: 1800,
        intervalS,
        motion: [],
      });
      const quiet = { intervalS, reportSpeed: false, motion: [] } as const;
      const there = travel(
        [
          [0, -2000],
          [400, -2000],
        ],
        { ...quiet, startT: lastT(before) + intervalS, speedMs: 5, seed: 3 },
      );
      const shop = stay([400, -2000], {
        startT: lastT(there) + intervalS,
        durationS: 40,
        intervalS: Math.min(intervalS, 20),
        motion: [],
        seed: 4,
      });
      const back = travel(
        [
          [400, -2000],
          [0, -2000],
        ],
        { ...quiet, startT: lastT(shop) + intervalS, speedMs: 5, seed: 5 },
      );
      const after = stay([0, -2000], {
        startT: lastT(back) + intervalS,
        durationS: 1800,
        intervalS,
        motion: [],
        seed: 6,
      });
      const kinds = spansOf(concat(before, there, shop, back, after)).map((span) => span.kind);
      expect(kinds[0]).toBe("stop");
      expect(kinds.at(-1)).toBe("stop");
      expect(kinds).toContain("move");
    });
  }

  it("does not merge stays across a jump of more than 300 m", () => {
    // Ten minutes without a point between two places: within 300 m iOS resumed outside its
    // geofence (one stop), farther the phone was carried there (a move in between).
    const here = stay([0, -2000], { startT: morning, durationS: 600, intervalS: 10 });
    const there = (x: number) =>
      stay([x, -2000], { startT: lastT(here) + 600, durationS: 600, intervalS: 10, seed: 4 });
    expect(spansOf(concat(here, there(250))).map((span) => span.kind)).toEqual(["stop"]);
    const spans = spansOf(concat(here, there(400)));
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move", "stop"]);
    expect(spans[1]).toEqual({
      kind: "move",
      from: lastT(here) - morning,
      to: lastT(here) + 600 - morning,
    });
  });
});

describe("a visit's stay and a fix far off", () => {
  // Four hours at home, one fix `offM` east, four hours more.
  const night = (intervalS: number, offM = 350) => {
    const before = stay([-600, -400], {
      startT: morning,
      durationS: 4 * 3600,
      intervalS,
      noiseM: 10,
      accuracy: 30,
    });
    const [lon, lat] = toLonLat(-600 + offM, -400);
    const outlier: RawPoint = {
      t: lastT(before) + intervalS,
      lat,
      lon,
      accuracy: 65,
      speed: null,
      altitude: null,
      verticalAccuracy: null,
      motion: [],
    };
    const after = stay([-600, -400], {
      startT: outlier.t + intervalS,
      durationS: 4 * 3600,
      intervalS,
      noiseM: 10,
      accuracy: 30,
      seed: 5,
    });
    return { points: concat(before, [outlier], after), outlierT: outlier.t };
  };

  for (const intervalS of [10, 60, 300]) {
    for (const departedAt of [null, morning + 9 * 3600]) {
      it(`keeps the night one stop, a point every ${intervalS} s, departure ${departedAt === null ? "unknown" : "known"}`, () => {
        const { points, outlierT } = night(intervalS);
        const spans = spansOf(points, [visitAt(-600, -400, morning - 60, departedAt)]);
        const stops = spans.filter((span) => span.kind === "stop");
        expect(stops).toHaveLength(1);
        expect(stops[0]?.from).toBeLessThan(outlierT - morning - 3600);
        expect(stops[0]?.to).toBeGreaterThan(outlierT - morning + 3600);
      });
    }
  }

  // iOS vouches for a visit with a known departure until then: with a point every six or ten
  // minutes, a fix off is no departure either.
  for (const intervalS of [360, 600]) {
    for (const offM of [170, 350]) {
      it(`keeps the night under a visit that ended one stop, a point every ${intervalS} s, one fix ${offM} m off`, () => {
        const { points, outlierT } = night(intervalS, offM);
        const spans = spansOf(points, [visitAt(-600, -400, morning - 60, morning + 9 * 3600)]);
        expect(spans.map((span) => span.kind)).toEqual(["stop"]);
        expect(spans[0]?.from).toBeLessThan(outlierT - morning - 3600);
      });
    }
  }

  it("ends the stay when the phone is beyond 300 m for two minutes, however sparse", () => {
    // Two fixes five minutes apart on the way out and back: the phone went somewhere.
    const home = stay([-600, -400], { startT: morning, durationS: 3600, intervalS: 300 });
    const gone = travel(
      [
        [-200, -400],
        [300, -400],
      ],
      { startT: lastT(home) + 300, speedMs: 500 / 300, intervalS: 300 },
    );
    const back = stay([-600, -400], { startT: lastT(gone) + 300, durationS: 3600, intervalS: 300 });
    const visit = visitAt(-600, -400, morning - 60, lastT(back) + 60);
    const spans = spansOf(concat(home, gone, back), [visit]);
    expect(spans.map((span) => span.kind)).toEqual(["stop", "move", "stop"]);
    expect(spans[0]?.to).toBe(lastT(home) - morning);
  });
});
