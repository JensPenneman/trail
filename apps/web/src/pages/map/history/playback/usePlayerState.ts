import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { PlaybackRate } from "./playbackModel";
import {
  initialPlayback,
  type PlaybackState,
  type PlaybackWorld,
  playbackReducer,
} from "./playbackReducer";

/** What the bar, the keys and the clock do to the player. Stable: they read the latest world. */
export interface PlayerControls {
  enter: (day: string, clock: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  exit: () => void;
  seek: (clock: number) => void;
  /** One step of the speed's minutes, back or forward. */
  step: (direction: -1 | 1) => void;
  /** The previous or next move (it may be on another day). */
  stepMove: (direction: -1 | 1) => void;
  setRate: (rate: PlaybackRate) => void;
  setSkipStops: (on: boolean) => void;
  dayLoaded: (day: string) => void;
  tick: (elapsedMs: number, now: number) => void;
}

export interface Player {
  state: PlaybackState;
  controls: PlayerControls;
  /** Tells the player what the page knows (`usePlayerEngine` does, every render). */
  publishWorld: (world: PlaybackWorld) => void;
}

/**
 * The player's state. It lives at the top of the History view, because the
 * day it is playing replaces the URL's period before the view's queries run;
 * the world it acts on (days, moves, what is loaded) comes from those
 * queries afterwards, through `publishWorld`.
 */
export function usePlayerState(): Player {
  const [state, dispatch] = useReducer(playbackReducer, initialPlayback);
  const world = useRef<PlaybackWorld | null>(null);
  const publishWorld = useCallback((next: PlaybackWorld) => {
    world.current = next;
  }, []);
  const controls = useMemo<PlayerControls>(() => {
    // Without a world nothing can move: the page publishes one before it shows a way to play.
    const act = (make: (known: PlaybackWorld) => Parameters<typeof dispatch>[0]) => {
      if (world.current !== null) dispatch(make(world.current));
    };
    return {
      enter: (day, clock) => act((known) => ({ type: "enter", day, clock, world: known })),
      play: () => act((known) => ({ type: "play", world: known })),
      pause: () => dispatch({ type: "pause" }),
      toggle: () => act((known) => ({ type: "toggle", world: known })),
      exit: () => dispatch({ type: "exit" }),
      seek: (clock) => act((known) => ({ type: "seek", clock, world: known })),
      step: (direction) => act((known) => ({ type: "step", direction, world: known })),
      stepMove: (direction) => act((known) => ({ type: "stepMove", direction, world: known })),
      setRate: (rate) => dispatch({ type: "setRate", rate }),
      setSkipStops: (on) => dispatch({ type: "setSkipStops", on }),
      dayLoaded: (day) => dispatch({ type: "dayLoaded", day }),
      tick: (elapsedMs, now) => act((known) => ({ type: "tick", elapsedMs, now, world: known })),
    };
  }, []);
  return useMemo(() => ({ state, controls, publishWorld }), [state, controls, publishWorld]);
}

/** Publishes the world to the player after every render, before anything reads it. */
export function usePublishedWorld(player: Player, world: PlaybackWorld): void {
  const { publishWorld } = player;
  useLayoutEffect(() => {
    publishWorld(world);
  });
}
