import {
  dayBounds,
  dayOf,
  type Interval,
  nextDayWithData,
  type PlaybackRate,
  previousDayWithData,
  skippableQuietS,
} from "./playbackModel";

export type PlaybackStatus = "off" | "playing" | "paused" | "loading" | "ended";

export interface PlaybackState {
  status: PlaybackStatus;
  /** The local day the clock is in. */
  day: string;
  /** The day playback started on: Play from the end restarts there. */
  startDay: string;
  /** The moment shown, epoch seconds. */
  clock: number;
  /** Where playback started, epoch seconds: the earliest the clock goes. */
  start: number;
  rate: PlaybackRate;
  skipStops: boolean;
  /** Wall-clock milliseconds until which a skipped stop is shown before the jump; null when not held. */
  holdUntil: number | null;
  /**
   * A press of "Previous move" or "Next move" that went to another day, whose
   * moves are not in yet: resolved to that day's last or first move once they are.
   */
  pendingMove: -1 | 1 | null;
}

/**
 * What the reducer knows of the data, as the page has it at the moment of the
 * action: every action that can move the clock carries it, so the reducer
 * stays pure and the clock never waits on a render.
 */
export interface PlaybackWorld {
  timeZone: string;
  /** Days with data, ascending. */
  days: readonly string[];
  /** Whether `days` reaches today (else a later day may yet turn up). */
  daysComplete: boolean;
  /** Moves and quiet stretches of the day the clock is in. */
  moves: readonly Interval[];
  quiet: readonly Interval[];
  /**
   * Whether a day has what `moves` and `quiet` are made from: its tracks, and
   * for one's own the timeline (placeholder data is not loaded). With only one
   * of them in, the whole day would look quiet and "Skip stops" would jump over it.
   */
  loaded: (day: string) => boolean;
  /** The last recorded moment; null while unknown. */
  end: number | null;
}

export type PlaybackAction =
  | { type: "enter"; day: string; clock: number; world: PlaybackWorld }
  | { type: "play"; world: PlaybackWorld }
  | { type: "pause" }
  | { type: "toggle"; world: PlaybackWorld }
  | { type: "exit" }
  | { type: "seek"; clock: number; world: PlaybackWorld }
  | { type: "step"; direction: -1 | 1; world: PlaybackWorld }
  | { type: "stepMove"; direction: -1 | 1; world: PlaybackWorld }
  | { type: "resolveMove"; world: PlaybackWorld }
  | { type: "setRate"; rate: PlaybackRate }
  | { type: "setSkipStops"; on: boolean }
  | { type: "dayLoaded"; day: string }
  | { type: "tick"; elapsedMs: number; now: number; world: PlaybackWorld };

export const initialPlayback: PlaybackState = {
  status: "off",
  day: "1970-01-01",
  startDay: "1970-01-01",
  clock: 0,
  start: 0,
  rate: 5,
  skipStops: false,
  holdUntil: null,
  pendingMove: null,
};

/** How long a skipped stop shows before the clock jumps over it. */
const holdMs = 500;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** The status for being in `day`: playing, or loading while its tracks are not in. */
const running = (state: PlaybackState, world: PlaybackWorld): PlaybackStatus =>
  world.loaded(state.day) ? "playing" : "loading";

/** The clock at `clock` (clamped to start … end), its day and status following. */
function moveTo(state: PlaybackState, clock: number, world: PlaybackWorld): PlaybackState {
  const to = clamp(clock, state.start, world.end ?? Number.POSITIVE_INFINITY);
  const day = dayOf(to, world.timeZone);
  const moved = { ...state, clock: to, day, holdUntil: null, pendingMove: null };
  if (state.status === "playing" || state.status === "loading") {
    return { ...moved, status: running(moved, world) };
  }
  // A paused player stays so; an ended one reopens as paused once moved back from the end,
  // and stays ended at it (Play then starts over).
  const atEnd = world.end !== null && to >= world.end;
  return { ...moved, status: state.status === "ended" && !atEnd ? "paused" : state.status };
}

/** The quiet stretch the clock is in, when it is one "Skip stops" jumps over. */
function skippable(clock: number, world: PlaybackWorld): Interval | null {
  const found = world.quiet.find((q) => clock >= q.from && clock < q.to);
  // What is left of the stretch counts: a seek into its last seconds has nothing to skip.
  return found !== undefined && found.to - clock > skippableQuietS ? found : null;
}

/**
 * Ends playback at the last recorded point, or crosses midnight into the next
 * day with data (loading it, if it is not in); a clock past the end of the
 * day with nothing known after it waits at midnight.
 */
function settle(state: PlaybackState, world: PlaybackWorld): PlaybackState {
  if (world.end !== null && state.clock >= world.end) {
    return { ...state, clock: world.end, status: "ended", holdUntil: null };
  }
  const { end: dayEnd } = dayBounds(state.day, world.timeZone);
  if (state.clock < dayEnd) return state;
  const next = nextDayWithData(world.days, state.day);
  if (next === null) {
    return world.daysComplete
      ? { ...state, clock: world.end ?? dayEnd, status: "ended", holdUntil: null }
      : { ...state, clock: dayEnd, holdUntil: null };
  }
  const crossed = { ...state, day: next, clock: dayBounds(next, world.timeZone).start };
  return { ...crossed, status: running(crossed, world), holdUntil: null };
}

function tick(
  state: PlaybackState,
  action: Extract<PlaybackAction, { type: "tick" }>,
): PlaybackState {
  const { world, now, elapsedMs } = action;
  if (state.status !== "playing") return state;
  if (state.holdUntil !== null) {
    if (now < state.holdUntil) return state;
    // The stop has been shown: on to where it ends.
    const quiet = skippable(state.clock, world);
    return settle({ ...state, clock: quiet?.to ?? state.clock, holdUntil: null }, world);
  }
  const moved = { ...state, clock: state.clock + (elapsedMs / 1000) * state.rate * 60 };
  const settled = settle(moved, world);
  if (settled.status !== "playing" || settled.day !== moved.day) return settled;
  if (settled.skipStops && skippable(settled.clock, world) !== null) {
    return { ...settled, holdUntil: now + holdMs };
  }
  return settled;
}

/**
 * A move's start strictly after / before `clock` (a second's tolerance, so that a press leaves
 * the one it is on). With none left on the day it goes on to the next or previous day with data
 * and remembers the direction: that day's moves are not known yet, and the press is finished
 * with them (`resolveMove`), so that it lands on a move rather than in a quiet stretch.
 */
function stepMove(state: PlaybackState, direction: -1 | 1, world: PlaybackWorld): PlaybackState {
  const edge = 1;
  if (direction === 1) {
    const next = world.moves.find((move) => move.from > state.clock + edge);
    if (next !== undefined) return moveTo(state, next.from, world);
    const day = nextDayWithData(world.days, state.day);
    return day === null
      ? state
      : { ...moveTo(state, dayBounds(day, world.timeZone).start, world), pendingMove: 1 };
  }
  const before = [...world.moves].reverse().find((move) => move.from < state.clock - edge);
  if (before !== undefined) return moveTo(state, before.from, world);
  const day = previousDayWithData(world.days, state.day);
  if (day === null || dayBounds(day, world.timeZone).end - 1 < state.start) {
    return moveTo(state, state.start, world);
  }
  return { ...moveTo(state, dayBounds(day, world.timeZone).end - 1, world), pendingMove: -1 };
}

/** Finishes a move step that crossed days, now that the day it landed on is in. */
function resolveMove(state: PlaybackState, world: PlaybackWorld): PlaybackState {
  const { pendingMove: direction } = state;
  if (direction === null || state.status === "off" || !world.loaded(state.day)) return state;
  const target =
    direction === 1
      ? world.moves.find((move) => move.from >= state.clock)
      : [...world.moves].reverse().find((move) => move.from <= state.clock);
  if (target !== undefined) return moveTo(state, target.from, world);
  // The day has no move: on to the one after it (or before), as a press would.
  return stepMove({ ...state, pendingMove: null }, direction, world);
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case "enter": {
      const { world } = action;
      const clock = Math.min(action.clock, world.end ?? Number.POSITIVE_INFINITY);
      const entered: PlaybackState = {
        ...state,
        day: action.day,
        startDay: action.day,
        clock,
        start: clock,
        holdUntil: null,
        status: "playing",
      };
      return { ...entered, status: running(entered, world) };
    }
    case "play": {
      if (state.status === "off" || state.status === "playing" || state.status === "loading") {
        return state;
      }
      const from =
        state.status === "ended"
          ? {
              ...state,
              day: state.startDay,
              clock: state.start,
              holdUntil: null,
              pendingMove: null,
            }
          : state;
      return { ...from, status: running(from, action.world) };
    }
    case "pause":
      return state.status === "playing" || state.status === "loading"
        ? { ...state, status: "paused", holdUntil: null, pendingMove: null }
        : state;
    case "toggle":
      if (state.status === "playing" || state.status === "loading") {
        return playbackReducer(state, { type: "pause" });
      }
      return playbackReducer(state, { type: "play", world: action.world });
    case "exit":
      return { ...initialPlayback, rate: state.rate, skipStops: state.skipStops };
    case "seek":
      return state.status === "off" ? state : moveTo(state, action.clock, action.world);
    case "step":
      return state.status === "off"
        ? state
        : moveTo(state, state.clock + action.direction * state.rate * 60, action.world);
    case "stepMove":
      return state.status === "off" ? state : stepMove(state, action.direction, action.world);
    case "resolveMove":
      return resolveMove(state, action.world);
    case "setRate":
      return { ...state, rate: action.rate };
    case "setSkipStops":
      return { ...state, skipStops: action.on, holdUntil: action.on ? state.holdUntil : null };
    case "dayLoaded":
      return state.status === "loading" && state.day === action.day
        ? { ...state, status: "playing" }
        : state;
    case "tick":
      return tick(state, action);
  }
}
