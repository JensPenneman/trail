import type { RawPoint } from "../../src/processing/pipelineTypes";
import {
  busStops,
  concat,
  cyclewayLine,
  ferryLine,
  footpathLine,
  lastT,
  mainRoad,
  motorwayLine,
  pathLength,
  railLine,
  railY,
  stationA,
  stationB,
  stay,
  subPath,
  tramLine,
  tramStops,
  travel,
  type Vertex,
} from "./syntheticWorld";

/*
 * Journeys through the synthetic world as a phone running Overland records
 * them: dense (1 Hz) for most, sparse for the train the owner rarely tracks
 * densely, with GPS noise, reported speeds and CoreMotion activities.
 */

/** 26 October 2026, 08:00 UTC. */
export const morning = 1_793_000_000;

const walking = ["walking"];
const driving = ["driving"];
const cycling = ["cycling"];

/** Through the street grid near station A, then along the park path: 20 minutes on foot. */
export function walkInTown(startT = morning): RawPoint[] {
  const streets: Vertex[] = [
    [-1800, -800],
    [-1800, -200],
    [-1400, -200],
    [-1400, 400],
    [-2000, 400],
    [-2000, 800],
  ];
  const route = [...streets, ...footpathLine.slice(1, 24)];
  return travel(route, {
    startT,
    speedMs: 1.35,
    intervalS: 1,
    noiseM: 3,
    accuracy: 6,
    motion: walking,
    seed: 11,
  });
}

/** 20 minutes on the motorway at 108 km/h. */
export function motorwayDrive(startT = morning): RawPoint[] {
  const route = subPath(motorwayLine, 500, 500 + 30 * 1200);
  return travel(route, {
    startT,
    speedMs: 30,
    intervalS: 1,
    noiseM: 3,
    accuracy: 5,
    motion: driving,
    seed: 12,
  });
}

/** The bus up the main road: stopping at each bus stop for half a minute. */
export function busRide(startT = morning): RawPoint[] {
  const route = mainRoad;
  const pauses = busStops
    .map(([, y]) => ({ atM: y - (mainRoad[0]?.[1] ?? 0), seconds: 30 }))
    .filter((pause) => pause.atM > 50 && pause.atM < pathLength(route) - 50);
  return travel(route, {
    startT,
    speedMs: 9,
    intervalS: 1,
    noiseM: 3,
    accuracy: 6,
    motion: driving,
    seed: 13,
    pauses,
  });
}

/** 15 minutes on the cycleway at 18 km/h. */
export function bikeRide(
  startT = morning,
  options: { motion?: readonly string[] } = {},
): RawPoint[] {
  const route = subPath(cyclewayLine, 0, 4500);
  return travel(route, {
    startT,
    speedMs: 5,
    intervalS: 1,
    noiseM: 3,
    accuracy: 6,
    motion: options.motion ?? cycling,
    seed: 14,
  });
}

/** Distance along the railway from station A to the point at `x`. */
const railDistanceTo = (x: number): number => {
  const until = railLine.filter(([vx]) => vx <= x);
  return pathLength([...until, [x, railY(x)]]);
};

/**
 * The train from station A to station B the way the owner records it: a few
 * minutes waiting on the platform, then a point every 3 to 5 minutes at
 * 120 km/h, a stop of 90 s at the halt, and a few minutes at B.
 */
export function sparseTrain(startT = morning): RawPoint[] {
  const halfway = railDistanceTo(15_000);
  const intervals = [240, 200, 300, 180, 260, 220, 280, 190, 250, 210];
  const ride = travel(railLine, {
    startT: startT + 360,
    speedMs: 33.3,
    intervalS: (index) => intervals[index % intervals.length] ?? 240,
    noiseM: 6,
    accuracy: 10,
    motion: driving,
    seed: 15,
    pauses: [{ atM: halfway, seconds: 90 }],
  });
  const platform = stay([stationA[0] + 5, stationA[1] + 12], {
    startT,
    durationS: 300,
    intervalS: 60,
    noiseM: 5,
    accuracy: 10,
    seed: 16,
  });
  const arrival = stay([stationB[0] + 5, stationB[1] + 12], {
    startT: lastT(ride) + 120,
    durationS: 300,
    intervalS: 60,
    noiseM: 5,
    accuracy: 10,
    seed: 17,
  });
  return concat(platform, ride, arrival);
}

/**
 * On foot to station A, a minute and a half on the platform, the train to B
 * recorded densely, and on foot again from station B: one journey without a
 * stop of three minutes, which the splitting stage cuts in three.
 */
export function walkTrainWalk(startT = morning): RawPoint[] {
  const toStation: Vertex[] = [
    [-600, -400],
    [-600, 0],
    [-200, 0],
    [-100, 0],
    [0, 12],
  ];
  const walkTo = travel(toStation, {
    startT,
    speedMs: 1.4,
    intervalS: 1,
    noiseM: 3,
    accuracy: 6,
    motion: walking,
    seed: 21,
  });
  const waitStart = lastT(walkTo) + 1;
  const wait = travel(
    [
      [0, 12],
      [8, 10],
    ],
    {
      startT: waitStart,
      speedMs: 0.1,
      intervalS: 2,
      noiseM: 2,
      accuracy: 8,
      motion: ["stationary"],
      seed: 22,
    },
  );
  const ride = travel(railLine, {
    startT: lastT(wait) + 1,
    speedMs: 33,
    intervalS: 2,
    noiseM: 4,
    accuracy: 8,
    motion: driving,
    seed: 23,
  });
  const fromStation: Vertex[] = [
    [stationB[0], stationB[1] + 12],
    [30_100, 2000],
    [30_200, 2000],
    [30_600, 2000],
    [30_600, 2400],
  ];
  const walkFrom = travel(fromStation, {
    startT: lastT(ride) + 2,
    speedMs: 1.4,
    intervalS: 1,
    noiseM: 3,
    accuracy: 6,
    motion: walking,
    seed: 24,
  });
  return concat(walkTo, wait, ride, walkFrom);
}

/** The tram along its street at 22 km/h, half a minute at every stop. */
export function tramRide(startT = morning): RawPoint[] {
  const route = subPath(tramLine, 0, 4800);
  const pauses = tramStops
    .map(([x]) => ({ atM: -3000 - x, seconds: 25 }))
    .filter((pause) => pause.atM > 50 && pause.atM < 4750);
  return travel(route, {
    startT,
    speedMs: 6,
    intervalS: 1,
    noiseM: 3,
    accuracy: 6,
    motion: driving,
    seed: 31,
    pauses,
  });
}

/** The ferry across the river, a point every 5 s. */
export function ferryCrossing(startT = morning): RawPoint[] {
  return travel(ferryLine, {
    startT,
    speedMs: 4.5,
    intervalS: 5,
    noiseM: 5,
    accuracy: 10,
    motion: driving,
    seed: 41,
  });
}

/** Half an hour on a desk: 10 m of GPS jitter around one spot. */
export function deskJitter(startT = morning): RawPoint[] {
  return stay([-1500, 300], {
    startT,
    durationS: 1800,
    intervalS: 1,
    noiseM: 6,
    accuracy: 15,
    seed: 51,
  });
}

/** A flight: climbing, cruising at 830 km/h at 10 km, a point every 30 s. */
export function flight(startT = morning): RawPoint[] {
  const route: Vertex[] = [
    [40_000, 0],
    [400_000, 120_000],
  ];
  return travel(route, {
    startT,
    speedMs: 230,
    intervalS: 30,
    noiseM: 15,
    accuracy: 30,
    altitude: 10_000,
    motion: [],
    seed: 61,
  });
}

/**
 * A commuter's day recorded at 1 Hz throughout (the High resolution preset,
 * which never pauses): half an hour at home, on foot to station A, the train
 * to B, on foot to the office, four hours there, and the same way back —
 * about 20 000 points, the benchmark's day.
 */
export function denseDay(startT = morning): RawPoint[] {
  const home: Vertex = [-600, -400];
  const office: Vertex = [30_600, 2400];
  const toStation: Vertex[] = [home, [-600, 0], [-200, 0], [-100, 0], [0, 12]];
  const fromStation: Vertex[] = [
    [stationB[0], stationB[1] + 12],
    [30_100, 2000],
    [30_200, 2000],
    [30_600, 2000],
    office,
  ];
  const legs: RawPoint[][] = [];
  let t = startT;
  const add = (points: RawPoint[], gap = 1) => {
    legs.push(points);
    t = lastT(points) + gap;
  };
  add(stay(home, { startT: t, durationS: 1800, intervalS: 1, noiseM: 5, accuracy: 12, seed: 71 }));
  add(
    travel(toStation, {
      startT: t,
      speedMs: 1.4,
      intervalS: 1,
      noiseM: 3,
      accuracy: 6,
      motion: walking,
      seed: 72,
    }),
  );
  add(stay([4, 12], { startT: t, durationS: 90, intervalS: 2, noiseM: 2, accuracy: 8, seed: 73 }));
  add(
    travel(railLine, {
      startT: t,
      speedMs: 33,
      intervalS: 1,
      noiseM: 4,
      accuracy: 8,
      motion: driving,
      seed: 74,
    }),
  );
  add(
    travel(fromStation, {
      startT: t,
      speedMs: 1.4,
      intervalS: 1,
      noiseM: 3,
      accuracy: 6,
      motion: walking,
      seed: 75,
    }),
  );
  add(
    stay(office, {
      startT: t,
      durationS: 4 * 3600,
      intervalS: 1,
      noiseM: 6,
      accuracy: 15,
      seed: 76,
    }),
  );
  add(
    travel([...fromStation].reverse(), {
      startT: t,
      speedMs: 1.4,
      intervalS: 1,
      noiseM: 3,
      accuracy: 6,
      motion: walking,
      seed: 77,
    }),
  );
  add(
    travel([...railLine].reverse(), {
      startT: t,
      speedMs: 33,
      intervalS: 1,
      noiseM: 4,
      accuracy: 8,
      motion: driving,
      seed: 78,
    }),
  );
  add(
    travel([...toStation].reverse(), {
      startT: t,
      speedMs: 1.4,
      intervalS: 1,
      noiseM: 3,
      accuracy: 6,
      motion: walking,
      seed: 79,
    }),
  );
  return concat(...legs);
}
