import { useEffect } from "react";
import type { PlaybackWorld } from "./playbackReducer";
import { type Player, usePublishedWorld } from "./usePlayerState";

/** At most this many updates a second while playing smoothly. */
const framesPerSecond = 30;
const frameMs = 1000 / framesPerSecond;
/** A longer wait between two updates (a tab in the background) counts as this much. */
const maxStepMs = 250;
/** Reduced motion: the clock steps once a second instead of running. */
const steppedMs = 1000;

/**
 * Runs the clock while the player plays: animation frames, at most 30 updates a
 * second, each step capped at 250 ms of playback so that a tab that was asleep
 * does not jump; with reduced motion, one step a second. Also tells the
 * player what the page knows, and wakes a player that waited for a day's
 * tracks once they are in.
 */
export function usePlayerEngine(
  player: Player,
  { world, reducedMotion }: { world: PlaybackWorld; reducedMotion: boolean },
): void {
  usePublishedWorld(player, world);
  const { status, day } = player.state;
  const { tick, dayLoaded } = player.controls;
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
}
