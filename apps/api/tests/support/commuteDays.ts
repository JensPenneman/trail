import type { RawPoint, VisitSpan } from "../../src/processing/pipelineTypes";
import {
  concat,
  cyclewayLine,
  lastT,
  railLine,
  railY,
  stationA,
  stationB,
  stay,
  toLonLat,
  travel,
  type Vertex,
} from "./syntheticWorld";

/*
 * Days of the commute Trail must get right, in the synthetic world: a night at
 * home recorded every second with an iOS visit whose departure may never come,
 * the bike to station A, the walk from the bike shed to the platform, the
 * train to station B halting on the way, the walk to the shed at B and the
 * bike to the office, a work day of sparse, drifting fixes under a visit with
 * a lunch walk away from it, and the same way back — day after day.
 */

/** What the phone did, leg by leg: the truth the segments are checked against. */
export interface Leg {
  kind: "home" | "bike" | "shed" | "walk" | "platform" | "train" | "work" | "lunch";
  startT: number;
  endT: number;
}

export interface CommuteDays {
  points: RawPoint[];
  /** The visit reports as iOS sends them (an arrival, and later its departure). */
  visits: VisitSpan[];
  legs: Leg[];
}

/** How the commute is recorded. */
export interface CommuteOptions {
  startT: number;
  days: number;
  /** Seconds between points on the bike and the walks (1: dense). */
  rideIntervalS?: number;
  /** Seconds between points on the train. */
  trainIntervalS?: number;
  /** Seconds between points at the office (iOS defers updates indoors). */
  workIntervalS?: number;
  /** Seconds between points at home at night (1, as Jens's phone does). */
  homeIntervalS?: number;
  /** Whether iOS's departure reports of the home visits arrive (as a second row, the next morning). */
  homeDepartures?: boolean;
  seed?: number;
}

const cycleY = (x: number): number => -2000 + 150 * Math.sin(x / 700);

export const home: Vertex = [-7500, cycleY(-7500)];
export const shedA: Vertex = [-120, 2];
export const platformA: Vertex = [stationA[0] + 5, stationA[1] + 12];
export const platformB: Vertex = [stationB[0] + 5, stationB[1] + 12];
export const shedB: Vertex = [30_100, 2000];
export const office: Vertex = [31_200, 2400];
const lunchPlace: Vertex = [31_200, 3000];

/** Home along the cycleway, through the streets west of station A, to its bike shed. */
const toStationA: Vertex[] = [
  ...cyclewayLine.filter(([x]) => x <= -3000 && x >= home[0]).reverse(),
  [-2600, -1400],
  [-2000, -800],
  [-2000, 0],
  [-200, 0],
  shedA,
];
const shedToPlatformA: Vertex[] = [shedA, [-100, 0], [0, 15], platformA];
const platformToShedB: Vertex[] = [platformB, [30_000, railY(30_000) + 15], shedB];
const shedBToOffice: Vertex[] = [shedB, [30_200, 2000], [31_200, 2000], office];

const visitAt = (place: Vertex, arrivedAt: number, departedAt: number | null): VisitSpan => {
  const [lon, lat] = toLonLat(place[0] + 6, place[1] - 4);
  return { arrivedAt, departedAt, lat, lon, accuracy: 15 };
};

/** The time a leg's points span. */
const along = (points: RawPoint[]) => ({ startT: points[0]?.t ?? 0, endT: lastT(points) });

/**
 * `days` commuter days from `startT` (07:00 of the first morning, at home):
 * every leg of every day, with the visits iOS would report.
 */
export function commuteDays(options: CommuteOptions): CommuteDays {
  const rideS = options.rideIntervalS ?? 1;
  const trainS = options.trainIntervalS ?? 5;
  const workS = options.workIntervalS ?? 45;
  const homeS = options.homeIntervalS ?? 1;
  const seed = options.seed ?? 100;
  const legs: Leg[] = [];
  const parts: RawPoint[][] = [];
  const visits: VisitSpan[] = [];
  let t = options.startT;
  const add = (kind: Leg["kind"], points: RawPoint[], gap = 1) => {
    parts.push(points);
    legs.push({ kind, ...along(points) });
    t = lastT(points) + gap;
  };
  const ride = (path: Vertex[], salt: number) =>
    travel(path, {
      startT: t,
      speedMs: 5,
      intervalS: rideS,
      noiseM: 4,
      accuracy: 8,
      motion: ["cycling"],
      seed: seed + salt,
    });
  const walk = (path: Vertex[], salt: number) =>
    travel(path, {
      startT: t,
      speedMs: 1.3,
      intervalS: Math.min(rideS, 5),
      noiseM: 3,
      accuracy: 8,
      motion: ["walking"],
      seed: seed + salt,
    });
  const wait = (place: Vertex, durationS: number, salt: number, accuracy = 10) =>
    stay(place, {
      startT: t,
      durationS,
      intervalS: Math.min(rideS, 5),
      noiseM: 4,
      accuracy,
      seed: seed + salt,
    });
  const train = (path: Vertex[], salt: number) =>
    travel(path, {
      startT: t,
      speedMs: 33,
      intervalS: trainS,
      noiseM: 5,
      accuracy: 10,
      motion: ["driving"],
      seed: seed + salt,
      // A halt on the way, and a station stop of a minute and a half.
      pauses: [
        { atM: 9000, seconds: 50 },
        { atM: 15_800, seconds: 90 },
      ],
    });

  for (let day = 0; day < options.days; day += 1) {
    const salt = day * 100;
    // The morning at home until a quarter past seven.
    add(
      "home",
      stay(home, {
        startT: t,
        durationS: 900,
        intervalS: homeS,
        noiseM: 3,
        accuracy: 12,
        seed: seed + salt + 1,
      }),
    );
    add("bike", ride(toStationA, salt + 2));
    add("shed", wait(shedA, 60, salt + 3, 8));
    add("walk", walk(shedToPlatformA, salt + 4));
    const atPlatform = t;
    add("platform", wait(platformA, 360, salt + 5));
    add("train", train(railLine, salt + 6));
    add("walk", walk(platformToShedB, salt + 7));
    add("shed", wait(shedB, 60, salt + 8, 8));
    add("bike", ride(shedBToOffice, salt + 9));
    visits.push(visitAt(platformA, atPlatform - 60, atPlatform + 360));
    // The work day: sparse fixes drifting indoors, a lunch walk away and back.
    const arrived = t;
    add(
      "work",
      stay(office, {
        startT: t,
        durationS: 4.5 * 3600,
        intervalS: workS,
        noiseM: 30,
        accuracy: 40,
        seed: seed + salt + 10,
      }),
    );
    add("lunch", walk([office, [31_200, 2600], lunchPlace], salt + 11));
    add("lunch", wait(lunchPlace, 900, salt + 23, 15));
    add("lunch", walk([lunchPlace, [31_200, 2600], office], salt + 12));
    add(
      "work",
      stay(office, {
        startT: t,
        durationS: 3.5 * 3600,
        intervalS: workS,
        noiseM: 30,
        accuracy: 40,
        seed: seed + salt + 13,
      }),
    );
    visits.push(visitAt(office, arrived, t + 60));
    // And back.
    add("bike", ride([...shedBToOffice].reverse(), salt + 14));
    add("shed", wait(shedB, 60, salt + 15, 8));
    add("walk", walk([...platformToShedB].reverse(), salt + 16));
    add("platform", wait(platformB, 300, salt + 17));
    add("train", train([...railLine].reverse(), salt + 18));
    add("walk", walk([...shedToPlatformA].reverse(), salt + 19));
    add("shed", wait(shedA, 60, salt + 20, 8));
    add("bike", ride([...toStationA].reverse(), salt + 21));
    // The night at home: iOS reports the arrival now, the departure (if ever) the next morning.
    const homeAt = t;
    const nightEnd = options.startT + (day + 1) * 86_400 - 1;
    add(
      "home",
      stay(home, {
        startT: t,
        durationS: nightEnd - t,
        intervalS: homeS,
        noiseM: 3,
        accuracy: 12,
        seed: seed + salt + 22,
      }),
    );
    visits.push(visitAt(home, homeAt + 20, null));
    if (options.homeDepartures === true) {
      visits.push(visitAt(home, homeAt + 20, options.startT + (day + 1) * 86_400 + 900));
    }
    t = options.startT + (day + 1) * 86_400;
  }
  return { points: concat(...parts), visits, legs };
}

/** Legs that are travel: the bike rides and the trains. */
export const rides = (legs: readonly Leg[]): Leg[] =>
  legs.filter((leg) => leg.kind === "bike" || leg.kind === "train");
