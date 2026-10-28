/*
 * The day of a phone (docs/design/capacity.md §2.1, §6.2): when it moves, where
 * it is at every second, which points it records and when it uploads them —
 * a function of its seed and of time, so k6 and Node compute the same points
 * whenever they need them, and a run of a thousand phones over a whole day
 * keeps nothing but the times of the uploads.
 *
 * Time is "run time": whole seconds from the start of the run. A run plays one
 * day in `daySeconds` (86 400 for a soak, less for a compressed day): the
 * share of phones moving at every moment is that of the hour of the day it
 * stands for, and a phone records and sends at its app's real rates, so a
 * compressed day has the day's rates and peaks in less time. What a
 * compressed day changes is the length of moves and stops: they shrink with
 * the day.
 */

import { behaviours, hourlyWeights, modes, probeProfile, profiles } from "./profiles.js";
import { between, gaussian, randomFor, seedOf, weighted } from "./random.js";
import { positionAlong } from "./routes.js";

/**
 * @typedef {import("./profiles.js").Profile} Profile
 * @typedef {import("./profiles.js").Mode} Mode
 * @typedef {import("./routes.js").Route} Route
 * @typedef {{ daySeconds: number, dayStartHour: number, seed: number }} RunShape
 * @typedef {{ from: number, to: number, mode: Mode, speedMs: number, startM: number }} Move
 * @typedef {{ from: number, to: number, kind: "still" | "moving" | "tail", move: Move | null, stopAtM: number }} State
 * @typedef {{
 *   index: number,
 *   profileName: string,
 *   profile: Profile,
 *   behaviour: keyof typeof behaviours,
 *   route: Route,
 *   seed: number,
 *   states: State[],
 *   moves: Move[],
 *   from: number,
 *   to: number,
 * }} PhonePlan
 * @typedef {{
 *   t: number, lon: number, lat: number, speedMs: number | null, course: number | null,
 *   accuracyM: number, altitudeM: number, motion: string[], battery: number, moving: boolean,
 *   mode: Mode | null,
 * }} Point
 */

/** The SSE probe's phone records like OwnTracks for iOS in move mode, but uploads itself. */
const probe = profiles["owntracks-ios-move"];

/**
 * @param {string} name
 * @returns {Profile}
 */
function profileOf(name) {
  if (name === probeProfile && probe !== undefined) return probe;
  const profile = profiles[name];
  if (profile === undefined) throw new Error(`unknown phone profile ${name}`);
  return profile;
}

/** @param {number} value */
const hash32 = (value) => {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
};

/**
 * A uniform number in [0, 1) for one second of one phone: the same every time it is asked.
 * @param {number} seed
 * @param {number} second
 * @param {number} salt
 */
const unitAt = (seed, second, salt) => hash32(seed ^ hash32(second * 31 + salt)) / 4294967296;

/**
 * The behaviour of person `index` (§2.1: half commute, 15 % drive, 35 % stay home), seeded.
 * @param {number} seed
 * @param {number} index
 * @returns {keyof typeof behaviours}
 */
function behaviourOf(seed, index) {
  return weighted(
    randomFor(seed, "behaviour", index),
    /** @type {[keyof typeof behaviours, number][]} */ (
      Object.entries(behaviours).map(([name, behaviour]) => [name, behaviour.share])
    ),
  );
}

/**
 * The moves of one day in day seconds (0–86 400): the behaviour's moving
 * minutes in moves of its length, started at hours drawn from the hourly
 * weights, laid out without overlapping (five minutes apart at least).
 * @param {number} seed
 * @param {number} index
 * @param {keyof typeof behaviours} behaviourName
 * @returns {{ start: number, duration: number, mode: Mode }[]}
 */
function dayMoves(seed, index, behaviourName) {
  const random = randomFor(seed, "moves", index);
  const behaviour = behaviours[behaviourName];
  const hours = /** @type {[number, number][]} */ (
    hourlyWeights.map((weight, hour) => [hour, weight])
  );
  /** @type {{ start: number, duration: number, mode: Mode }[]} */
  const moves = [];
  let left = behaviour.movingMinutes * 60;
  while (left >= 60) {
    const duration = Math.min(left, Math.round(between(random, ...behaviour.moveMinutes) * 60));
    const hour = weighted(random, hours);
    moves.push({
      start: Math.floor((hour + random()) * 3600),
      duration,
      mode: weighted(random, behaviour.modes),
    });
    left -= duration;
  }
  moves.sort((a, b) => a.start - b.start);
  let free = 0;
  for (const move of moves) {
    move.start = Math.max(move.start, free);
    free = move.start + move.duration + 300;
  }
  return moves.filter((move) => move.start + move.duration <= 86_400);
}

/**
 * What a phone keeps through every run: its profile, seed, behaviour, route
 * and where on the route it starts.
 * @param {{ index: number, profile: string }} phone
 * @param {readonly Route[]} routes
 * @param {RunShape} shape
 */
function phoneBasics(phone, routes, shape) {
  const random = randomFor(shape.seed, "place", phone.index);
  const route = routes[Math.floor(random() * routes.length)] ?? routes[0];
  if (route === undefined) throw new Error("planPhone: no routes");
  return {
    basics: {
      index: phone.index,
      profileName: phone.profile,
      profile: profileOf(phone.profile),
      behaviour: behaviourOf(shape.seed, phone.index),
      route,
      seed: seedOf(shape.seed, "phone", phone.index),
    },
    startM: random() * 2 * route.length,
    random,
  };
}

/**
 * The phone's plan for run seconds `[0, daySeconds)`: the moves of its day
 * mapped onto the run (the day starting at `dayStartHour`), the stops between
 * them — with the minutes iOS goes on recording before it pauses, for the
 * Overland presets that pause — and its way along its route.
 * @param {{ index: number, profile: string }} phone
 * @param {readonly Route[]} routes
 * @param {RunShape} shape
 * @returns {PhonePlan}
 */
export function planPhone(phone, routes, shape) {
  const { basics, random, startM } = phoneBasics(phone, routes, shape);
  const { profile } = basics;
  const to = shape.daySeconds;
  const scale = shape.daySeconds / 86_400;
  const dayStart = shape.dayStartHour * 3600;

  /** @type {Move[]} */
  const moves = [];
  for (const move of dayMoves(shape.seed, phone.index, basics.behaviour)) {
    const from = Math.floor(((move.start - dayStart + 86_400) % 86_400) * scale);
    const length = Math.max(1, Math.round(move.duration * scale));
    const speedMs = modes[move.mode].speedMs * between(random, 0.8, 1.2);
    moves.push({ from, to: Math.min(to, from + length), mode: move.mode, speedMs, startM: 0 });
  }
  moves.sort((a, b) => a.from - b.from);
  const tailSeconds =
    profile.tailPerDay > 0 && moves.length > 0 && profile.movingPerMin > 0
      ? Math.max(
          1,
          Math.round((profile.tailPerDay / moves.length / profile.movingPerMin) * 60 * scale),
        )
      : 0;

  /** @type {State[]} */
  const states = [];
  /** @type {Move[]} */
  const kept = [];
  let distance = startM;
  let cursor = 0;
  for (const move of moves) {
    move.from = Math.max(move.from, cursor);
    if (move.to <= move.from) continue;
    if (move.from > cursor) {
      states.push({ from: cursor, to: move.from, kind: "still", move: null, stopAtM: distance });
    }
    move.startM = distance;
    states.push({ from: move.from, to: move.to, kind: "moving", move, stopAtM: distance });
    kept.push(move);
    distance += move.speedMs * (move.to - move.from);
    cursor = move.to;
    if (tailSeconds > 0 && cursor < to) {
      const end = Math.min(to, cursor + tailSeconds);
      states.push({ from: cursor, to: end, kind: "tail", move: null, stopAtM: distance });
      cursor = end;
    }
  }
  if (cursor < to) states.push({ from: cursor, to, kind: "still", move: null, stopAtM: distance });
  return { ...basics, states, moves: kept, from: 0, to };
}

/**
 * The plan of a phone's backlog (§2.3, "the morning after"): the `seconds`
 * before run second 0, uncompressed, as an average day spends them — still,
 * but for the behaviour's share of moving time as one move in the middle.
 * @param {{ index: number, profile: string }} phone
 * @param {readonly Route[]} routes
 * @param {RunShape} shape
 * @param {number} seconds
 * @returns {PhonePlan}
 */
export function planBacklog(phone, routes, shape, seconds) {
  const { basics, startM } = phoneBasics(phone, routes, shape);
  const behaviour = behaviours[basics.behaviour];
  const moving = Math.round((seconds * behaviour.movingMinutes) / 1440);
  const from = -seconds;
  if (moving < 60) {
    return {
      ...basics,
      states: [{ from, to: 0, kind: "still", move: null, stopAtM: startM }],
      moves: [],
      from,
      to: 0,
    };
  }
  const mode = behaviour.modes[0]?.[0] ?? "walking";
  const start = Math.round(from / 2 - moving / 2);
  /** @type {Move} */
  const move = { from: start, to: start + moving, mode, speedMs: modes[mode].speedMs, startM };
  return {
    ...basics,
    states: [
      { from, to: move.from, kind: "still", move: null, stopAtM: startM },
      { from: move.from, to: move.to, kind: "moving", move, stopAtM: startM },
      { from: move.to, to: 0, kind: "still", move: null, stopAtM: startM + move.speedMs * moving },
    ],
    moves: [move],
    from,
    to: 0,
  };
}

/**
 * Points a minute in a state.
 * @param {Profile} profile
 * @param {State} state
 */
const rateOf = (profile, state) =>
  state.kind === "still" ? profile.stillPerMin : profile.movingPerMin;

/**
 * The seconds of a state at which the phone records, in `[from, to)`: a
 * regular rhythm where the app has one (every 5 s, every minute), a random one
 * at its mean rate where iOS decides (a still phone's fixes, significant
 * changes) — always whole seconds, one point a second at most.
 * @param {PhonePlan} plan
 * @param {State} state
 * @param {number} from
 * @param {number} to
 * @returns {number[]}
 */
function secondsIn(plan, state, from, to) {
  const rate = rateOf(plan.profile, state);
  if (!(rate > 0)) return [];
  const start = Math.max(Math.ceil(from), Math.ceil(state.from));
  const end = Math.min(to, state.to);
  /** @type {number[]} */
  const seconds = [];
  const interval = 60 / rate;
  if (Number.isInteger(interval)) {
    const phase = hash32(plan.seed ^ interval) % interval;
    const first = start + ((((phase - start) % interval) + interval) % interval);
    for (let second = first; second < end; second += interval) seconds.push(second);
    return seconds;
  }
  const chance = rate / 60;
  for (let second = start; second < end; second += 1) {
    if (unitAt(plan.seed, second, 1) < chance) seconds.push(second);
  }
  return seconds;
}

/**
 * The state the phone is in at a second.
 * @param {PhonePlan} plan
 * @param {number} second
 */
export function stateAt(plan, second) {
  let low = 0;
  let high = plan.states.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((plan.states[middle]?.from ?? 0) <= second) low = middle;
    else high = middle - 1;
  }
  return plan.states[low];
}

/**
 * The point the phone records at a second: where it is on its route (or at
 * its stop), with GPS noise of its accuracy, its speed, course, altitude,
 * motion and battery.
 * @param {PhonePlan} plan
 * @param {State} state
 * @param {number} second
 * @returns {Point}
 */
function pointAt(plan, state, second) {
  const random = randomFor(plan.seed, "point", second);
  const moving = state.kind === "moving" && state.move !== null;
  const along =
    moving && state.move !== null
      ? state.move.startM + state.move.speedMs * (second - state.move.from)
      : state.stopAtM;
  const place = positionAlong(plan.route, along);
  const accuracyM = Math.max(
    3,
    Math.round(
      (moving ? plan.profile.accuracyM.moving : plan.profile.accuracyM.still) *
        between(random, 0.6, 1.4),
    ),
  );
  const noiseM = accuracyM / 2;
  const north = gaussian(random) * noiseM;
  const east = gaussian(random) * noiseM;
  const lat = place.lat + north / 111_195;
  const lon = place.lon + east / (111_195 * Math.cos((place.lat * Math.PI) / 180));
  const mode = moving && state.move !== null ? state.move.mode : null;
  const speedMs =
    moving && state.move !== null
      ? Math.max(0, state.move.speedMs * between(random, 0.85, 1.15))
      : 0;
  const span = Math.max(1, plan.to - plan.from);
  return {
    t: second,
    lon: Math.round(lon * 1e7) / 1e7,
    lat: Math.round(lat * 1e7) / 1e7,
    speedMs: Math.round(speedMs * 10) / 10,
    course: moving ? Math.round(place.bearing) : null,
    accuracyM,
    altitudeM: Math.round((9 + gaussian(random) * 2) * 10) / 10,
    motion: mode === null ? ["stationary"] : [modes[mode].motion],
    battery: Math.round((0.95 - (0.4 * (second - plan.from)) / span) * 100) / 100,
    moving,
    mode,
  };
}

/**
 * Every point the phone records in run seconds `[from, to)`, oldest first.
 * @param {PhonePlan} plan
 * @param {number} from
 * @param {number} to
 * @returns {Point[]}
 */
export function pointsBetween(plan, from, to) {
  /** @type {Point[]} */
  const points = [];
  for (const state of plan.states) {
    if (state.to <= from || state.from >= to) continue;
    for (const second of secondsIn(plan, state, from, to))
      points.push(pointAt(plan, state, second));
  }
  return points;
}

/**
 * How many points the phone records in `[from, to)`, without building them.
 * @param {PhonePlan} plan
 * @param {number} from
 * @param {number} to
 */
export function countBetween(plan, from, to) {
  let total = 0;
  for (const state of plan.states) {
    if (state.to <= from || state.from >= to) continue;
    total += secondsIn(plan, state, from, to).length;
  }
  return total;
}

/**
 * An upload of the schedule: `[phone, at (ms of run time), from, to, kind]`,
 * where kind 0 carries the points recorded in `[from, to)` and kind 1 is an
 * OwnTracks region event (`from` = 1 entering, 0 leaving).
 * @typedef {[number, number, number, number, number]} UploadRef
 */

/**
 * When the phone uploads in run seconds `[from, to)` (§2.2): Overland at its
 * interval whatever it recorded since, if anything; the other apps every point
 * on its own, a moment after the fix; OwnTracks for iOS also the region events
 * of leaving and reaching a stop.
 * @param {PhonePlan} plan
 * @param {number} from
 * @param {number} to
 * @returns {UploadRef[]}
 */
export function uploadsOf(plan, from, to) {
  /** @type {UploadRef[]} */
  const uploads = [];
  const rule = plan.profile.upload;
  if (rule.kind === "batch") {
    const phase = hash32(plan.seed ^ 0x51ed) % rule.intervalS;
    let tick = from + ((((phase - from) % rule.intervalS) + rule.intervalS) % rule.intervalS);
    let since = tick - rule.intervalS;
    for (; tick < to; tick += rule.intervalS) {
      const recorded = countBetween(plan, Math.max(since, from), tick);
      if (recorded > 0) uploads.push([plan.index, tick * 1000, Math.max(since, from), tick, 0]);
      since = tick;
    }
  } else {
    for (const state of plan.states) {
      if (state.to <= from || state.from >= to) continue;
      for (const second of secondsIn(plan, state, from, to)) {
        uploads.push([plan.index, second * 1000 + 300, second, second + 1, 0]);
      }
    }
  }
  if (plan.profile.transitions) {
    for (const move of plan.moves) {
      if (move.from >= from && move.from < to)
        uploads.push([plan.index, move.from * 1000 + 500, 0, move.from, 1]);
      if (move.to >= from && move.to < to)
        uploads.push([plan.index, move.to * 1000 + 500, 1, move.to, 1]);
    }
  }
  return uploads.sort((a, b) => a[1] - b[1]);
}

/**
 * The visits iOS reports for Overland in `[from, to)` (§6.4): reaching a stop
 * (a visit without a departure) and leaving it (with both).
 * @param {PhonePlan} plan
 * @param {number} from
 * @param {number} to
 * @returns {{ at: number, arrived: number, departed: number | null, place: { lon: number, lat: number } }[]}
 */
export function visitsBetween(plan, from, to) {
  if (!plan.profile.visits) return [];
  /** @type {{ at: number, arrived: number, departed: number | null, place: { lon: number, lat: number } }[]} */
  const visits = [];
  let arrived = plan.from;
  for (const move of plan.moves) {
    const before = positionAlong(plan.route, move.startM);
    if (move.from >= from && move.from < to) {
      visits.push({ at: move.from, arrived, departed: move.from, place: before });
    }
    const after = positionAlong(plan.route, move.startM + move.speedMs * (move.to - move.from));
    if (move.to >= from && move.to < to)
      visits.push({ at: move.to, arrived: move.to, departed: null, place: after });
    arrived = move.to;
  }
  return visits;
}
