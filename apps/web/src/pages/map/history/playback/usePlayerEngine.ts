import { useEffect } from "react";
import type { PlaybackWorld } from "./playbackReducer";
import { type Player, usePublishedWorld } from "./usePlayerState";

/** At most this many updates a second while playing smoothly. */
const framesPerSecond = 30;
// A 60 Hz display hands frames over every 16.7 ms, give or take: two of them are about 33 ms, and
// waiting for 33.3 exactly would often wait for a third.
const frameMs = 1000 / framesPerSecond - 2;
/** A longer wait between two updates (a tab in the background) counts as this much. */
const maxStepMs = 250;
/** Reduced motion: the clock steps once a second instead of running. */
const steppedMs = 1000;

/**
 * Runs the clock while the player plays: animation frames, at most 30 updates a
 * second (a frame is due 2 ms early), each step capped at 250 ms of playback so that a tab that was asleep
 * does not jump; with reduced motion, one step a second. Also tells the
 * player what the page knows, and wakes a player that waited for a day's
 * tracks once they are in.
 */
export function usePlayerEngine(
  player: Player,
  { world, reducedMotion }: { world: PlaybackWorld; reducedMotion: boolean },
): void {
  usePublishedWorld(player, world);
  const { status, day, pendingMove } = player.state;
  // A day without moves steps on to the next with the same direction pending, and that day may
  // be loaded already: nothing but the day changes, so the effect's key names it.
  const pendingKey = pendingMove === null ? null : `${pendingMove}:${day}`;
  const { tick, dayLoaded, resolveMove } = player.controls;
  const loaded = world.loaded(day);

  useEffect(() => {
    if (status !== "playing") return undefined;
    if (reducedMotion) {
      const timer = setInterval(() => tick(steppedMs, performance.now()), steppedMs);
      return () => clearInterval(timer);
    }
    let last = performance.now();
    let frame = 0;
    const run = (timestamp: number) => {
      const elapsed = timestamp - last;
      if (elapsed >= frameMs) {
        last = timestamp;
        tick(Math.min(elapsed, maxStepMs), timestamp);
      }
      frame = requestAnimationFrame(run);
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [status, reducedMotion, tick]);

  useEffect(() => {
    if (status === "loading" && loaded) dayLoaded(day);
  }, [status, loaded, day, dayLoaded]);

  // A step to another day's move lands on it once that day's moves are in.
  useEffect(() => {
    if (pendingKey !== null && loaded) resolveMove();
  }, [pendingKey, loaded, resolveMove]);
}
