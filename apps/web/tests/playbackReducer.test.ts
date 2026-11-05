import { describe, expect, it } from "vitest";
import { dayBounds, type PlaybackRate } from "../src/pages/map/history/playback/playbackModel";
import {
  initialPlayback,
  type PlaybackAction,
  type PlaybackState,
  type PlaybackWorld,
  playbackReducer,
} from "../src/pages/map/history/playback/playbackReducer";

const zone = "Europe/Brussels";
const mon = "2026-11-02";
const tue = "2026-11-03";
const wed = "2026-11-04";
const thu = "2026-11-05";
const at = (day: string, hours: number, minutes = 0) =>
  dayBounds(day, zone).start + hours * 3600 + minutes * 60;

/** A world of days with data, everything loaded unless a day is listed as not. */
function world(overrides: Partial<PlaybackWorld> = {}): PlaybackWorld {
  return {
    timeZone: zone,
    days: [mon, tue, thu],
    daysComplete: true,
    moves: [],
    quiet: [],
    loaded: () => true,
    end: at(thu, 15),
    ...overrides,
  };
}

const run = (state: PlaybackState, ...actions: PlaybackAction[]) =>
  actions.reduce(playbackReducer, state);

const playingAt = (day: string, clock: number, rate: PlaybackRate = 5): PlaybackState => ({
  ...initialPlayback,
  status: "playing",
  day,
  startDay: mon,
  start: at(mon, 0),
  clock,
  rate,
});

const tick = (ms: number, w: PlaybackWorld, now = 0): PlaybackAction => ({
  type: "tick",
  elapsedMs: ms,
  now,
  world: w,
});

describe("entering and leaving", () => {
  it("starts playing from the moment given, which is where Play restarts from", () => {
    const state = run(initialPlayback, {
      type: "enter",
      day: tue,
      clock: at(tue, 14, 5),
      world: world(),
    });
    expect(state).toMatchObject({
      status: "playing",
      day: tue,
      startDay: tue,
      start: at(tue, 14, 5),
      clock: at(tue, 14, 5),
    });
  });

  it("waits for a day whose tracks are not in", () => {
    const w = world({ loaded: (day) => day !== tue });
    expect(
      run(initialPlayback, { type: "enter", day: tue, clock: at(tue, 1), world: w }).status,
    ).toBe("loading");
  });

  it("is reset by exit, which keeps the speed and Skip stops that were chosen", () => {
    const state = run(
      playingAt(tue, at(tue, 10), 15),
      { type: "setSkipStops", on: true },
      { type: "exit" },
    );
    expect(state).toEqual({ ...initialPlayback, rate: 15, skipStops: true });
  });
});

describe("the clock", () => {
  it.each([
    [1, 1000, 60],
    [5, 1000, 300],
    [15, 1000, 900],
    [60, 1000, 3600],
    [60, 250, 900],
    [5, 33, 9.9],
  ] as const)("at %i min/s a step of %i ms is %f seconds", (rate, ms, seconds) => {
    const from = at(tue, 10);
    const state = run(playingAt(tue, from, rate), tick(ms, world()));
    expect(state.clock - from).toBeCloseTo(seconds, 6);
  });

  it("does nothing unless playing", () => {
    for (const status of ["paused", "loading", "ended", "off"] as const) {
      const state = { ...playingAt(tue, at(tue, 10)), status };
      expect(run(state, tick(1000, world()))).toBe(state);
    }
  });

  it("crosses midnight into the next day with data, skipping the days without", () => {
    const state = run(playingAt(tue, at(tue, 23, 59), 5), tick(1000, world()));
    expect(state).toMatchObject({ status: "playing", day: thu, clock: at(thu, 0) });
  });

  it("waits for that day's tracks, then plays on", () => {
    const w = world({ loaded: (day) => day !== thu });
    const crossed = run(playingAt(tue, at(tue, 23, 59)), tick(1000, w));
    expect(crossed).toMatchObject({ status: "loading", day: thu, clock: at(thu, 0) });
    expect(run(crossed, tick(1000, w))).toBe(crossed);
    expect(run(crossed, { type: "dayLoaded", day: wed }).status).toBe("loading");
    expect(run(crossed, { type: "dayLoaded", day: thu }).status).toBe("playing");
  });

  it("waits at midnight while later days may still turn up", () => {
    const w = world({ days: [mon, tue], daysComplete: false, end: null });
    const state = run(playingAt(tue, at(tue, 23, 59)), tick(1000, w));
    expect(state).toMatchObject({ status: "playing", day: tue, clock: dayBounds(tue, zone).end });
  });

  it("ends at the last recorded point, and stops", () => {
    const w = world();
    const state = run(playingAt(thu, at(thu, 14, 59)), tick(1000, w));
    expect(state).toMatchObject({ status: "ended", clock: at(thu, 15) });
    expect(run(state, tick(1000, w))).toBe(state);
  });

  it("ends at the end of data when no later day exists", () => {
    const w = world({ days: [mon, tue], end: at(tue, 20) });
    expect(run(playingAt(tue, at(tue, 19, 59)), tick(1000, w)).status).toBe("ended");
  });

  it("restarts from the start moment on Play after the end", () => {
    const ended = { ...playingAt(thu, at(thu, 15)), status: "ended" as const, start: at(mon, 6) };
    const state = run(ended, { type: "play", world: world() });
    expect(state).toMatchObject({ status: "playing", day: mon, clock: at(mon, 6) });
  });
});

describe("pause, play and the speed", () => {
  it("toggles between playing and paused, and a loading player pauses", () => {
    const w = world();
    const playing = playingAt(tue, at(tue, 10));
    const paused = run(playing, { type: "toggle", world: w });
    expect(paused.status).toBe("paused");
    expect(run(paused, { type: "toggle", world: w }).status).toBe("playing");
    expect(run({ ...playing, status: "loading" }, { type: "pause" }).status).toBe("paused");
  });

  it("takes a new speed while playing without moving the clock", () => {
    const state = playingAt(tue, at(tue, 10), 5);
    expect(run(state, { type: "setRate", rate: 60 })).toEqual({ ...state, rate: 60 });
  });
});

describe("seeking and stepping", () => {
  const w = world();

  it("clamps to the start moment and the end", () => {
    const state = { ...playingAt(tue, at(tue, 10)), status: "paused" as const };
    expect(run(state, { type: "seek", clock: at(mon, 0) - 99, world: w }).clock).toBe(at(mon, 0));
    expect(run(state, { type: "seek", clock: at(thu, 20), world: w }).clock).toBe(at(thu, 15));
  });

  it("steps by the speed's minutes, back and forward", () => {
    const state = { ...playingAt(tue, at(tue, 10), 15), status: "paused" as const };
    expect(run(state, { type: "step", direction: 1, world: w }).clock).toBe(at(tue, 10, 15));
    expect(run(state, { type: "step", direction: -1, world: w }).clock).toBe(at(tue, 9, 45));
  });

  it("changes day with the clock, and waits there for tracks not in", () => {
    const state = { ...playingAt(tue, at(tue, 23, 58), 5), status: "paused" as const };
    const stepped = run(state, { type: "step", direction: 1, world: w });
    expect(stepped).toMatchObject({ day: wed, status: "paused" });
    const playing = playingAt(tue, at(tue, 23, 58));
    const away = run(playing, {
      type: "seek",
      clock: at(thu, 3),
      world: world({ loaded: () => false }),
    });
    expect(away).toMatchObject({ day: thu, status: "loading" });
  });

  it("opens a player that ended again, paused, once it is moved back", () => {
    const ended = { ...playingAt(thu, at(thu, 15)), status: "ended" as const };
    expect(run(ended, { type: "step", direction: -1, world: w }).status).toBe("paused");
  });

  it("keeps a player that ended at its end ended, so that Play starts over", () => {
    const ended = { ...playingAt(thu, at(thu, 15)), status: "ended" as const, start: at(mon, 6) };
    expect(run(ended, { type: "step", direction: 1, world: w }).status).toBe("ended");
    expect(run(ended, { type: "seek", clock: at(thu, 18), world: w }).status).toBe("ended");
  });

  it("forgets a pending move step when anything else moves the clock", () => {
    const pending = {
      ...playingAt(thu, at(thu, 0)),
      status: "paused" as const,
      pendingMove: 1 as const,
    };
    expect(run(pending, { type: "seek", clock: at(thu, 3), world: w }).pendingMove).toBeNull();
  });

  it("keeps a waiting move step through a pause, so that it still lands on a move", () => {
    const pending = {
      ...playingAt(thu, at(thu, 0)),
      status: "playing" as const,
      pendingMove: 1 as const,
    };
    expect(run(pending, { type: "pause" })).toMatchObject({ status: "paused", pendingMove: 1 });
  });

  it("drops a pending skip when moved", () => {
    const held = { ...playingAt(tue, at(tue, 3)), holdUntil: 5000 };
    expect(run(held, { type: "seek", clock: at(tue, 4), world: w }).holdUntil).toBeNull();
  });
});

describe("moves", () => {
  const moves = [
    { from: at(tue, 8), to: at(tue, 9) },
    { from: at(tue, 17), to: at(tue, 18) },
  ];
  const w = world({ moves });
  const paused = (clock: number): PlaybackState => ({
    ...playingAt(tue, clock),
    status: "paused",
  });

  it("go to the next and previous move of the day", () => {
    expect(run(paused(at(tue, 8, 30)), { type: "stepMove", direction: 1, world: w }).clock).toBe(
      at(tue, 17),
    );
    expect(run(paused(at(tue, 17, 30)), { type: "stepMove", direction: -1, world: w }).clock).toBe(
      at(tue, 17),
    );
    expect(run(paused(at(tue, 17)), { type: "stepMove", direction: -1, world: w }).clock).toBe(
      at(tue, 8),
    );
  });

  it("go on to the next day with data after the last move, and land on its first move once it is in", () => {
    const state = run(paused(at(tue, 17, 30)), { type: "stepMove", direction: 1, world: w });
    expect(state).toMatchObject({ day: thu, clock: at(thu, 0), pendingMove: 1 });
    // Thursday's moves arrive: the same press finishes on the first of them.
    const thursday = world({ moves: [{ from: at(thu, 7), to: at(thu, 8) }] });
    const landed = run(state, { type: "resolveMove", world: thursday });
    expect(landed).toMatchObject({ clock: at(thu, 7), pendingMove: null, status: "paused" });
    // A day with no move at all goes on to the day after it, or ends the press.
    const bare = run(state, { type: "resolveMove", world: world({ moves: [] }) });
    expect(bare).toMatchObject({ day: thu, clock: at(thu, 0), pendingMove: null });
    const loading = run(playingAt(tue, at(tue, 17, 30)), {
      type: "stepMove",
      direction: 1,
      world: world({ moves, loaded: (day) => day !== thu }),
    });
    expect(loading.status).toBe("loading");
  });

  it("go back to the last second of the previous day with data, never before the start", () => {
    const early = { ...paused(at(tue, 7)), start: at(mon, 0) };
    const back = run(early, { type: "stepMove", direction: -1, world: w });
    expect(back).toMatchObject({
      day: mon,
      clock: dayBounds(mon, zone).end - 1,
      pendingMove: -1,
    });
    const monday = world({ moves: [{ from: at(mon, 18), to: at(mon, 19) }] });
    expect(run(back, { type: "resolveMove", world: monday })).toMatchObject({
      clock: at(mon, 18),
      pendingMove: null,
    });
    const first = { ...paused(at(tue, 7)), start: at(tue, 6) };
    expect(run(first, { type: "stepMove", direction: -1, world: w }).clock).toBe(at(tue, 6));
  });

  it("stay where they are with no later day", () => {
    const last = { ...paused(at(thu, 12)), day: thu };
    const state = run(last, { type: "stepMove", direction: 1, world: world() });
    expect(state.clock).toBe(at(thu, 12));
  });
});

describe("Skip stops", () => {
  const quiet = [{ from: at(tue, 9), to: at(tue, 17) }];
  const w = world({ quiet });
  const on = (clock: number) => ({ ...playingAt(tue, clock), skipStops: true });

  it("shows a long quiet stretch for half a second, then jumps to its end", () => {
    const entered = run(on(at(tue, 8, 59)), { type: "setRate", rate: 60 }, tick(250, w, 1000));
    expect(entered.holdUntil).toBe(1500);
    expect(run(entered, tick(250, w, 1200))).toBe(entered);
    const jumped = run(entered, tick(250, w, 1500));
    expect(jumped).toMatchObject({ clock: at(tue, 17), holdUntil: null });
  });

  it("starts the hold when playback begins inside the stretch", () => {
    const started = run(on(at(tue, 12)), tick(33, w, 100));
    expect(started.holdUntil).toBe(600);
  });

  it("leaves what is left of a stretch alone when it is two minutes or less", () => {
    const nearEnd = world({ quiet: [{ from: at(tue, 9), to: at(tue, 17) }] });
    const state = run(on(at(tue, 16, 59)), { type: "setRate", rate: 1 }, tick(33, nearEnd, 0));
    expect(state.holdUntil).toBeNull();
  });

  it("leaves a stretch of two minutes or less alone", () => {
    const short = world({ quiet: [{ from: at(tue, 9), to: at(tue, 9, 2) }] });
    const state = run(on(at(tue, 8, 59)), { type: "setRate", rate: 1 }, tick(250, short, 10));
    expect(state.holdUntil).toBeNull();
  });

  it("does nothing when off, and a pause drops the hold", () => {
    const off = { ...playingAt(tue, at(tue, 12)), skipStops: false };
    expect(run(off, tick(33, w, 0)).holdUntil).toBeNull();
    const held = run(on(at(tue, 12)), tick(33, w, 0), { type: "pause" });
    expect(held).toMatchObject({ status: "paused", holdUntil: null });
  });

  it("jumps to the end of the day when the stretch runs to midnight, into the next day", () => {
    const night = world({ quiet: [{ from: at(tue, 20), to: dayBounds(tue, zone).end }] });
    const held = run(on(at(tue, 21)), tick(33, night, 0));
    const jumped = run(held, tick(33, night, 600));
    expect(jumped).toMatchObject({ day: thu, clock: at(thu, 0) });
  });
});
