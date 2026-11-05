import { useEffect, useRef } from "react";
import { useFormatter } from "../../../../format/useFormatter";
import { useAnnounce } from "../../../../ui/useAnnounce";
import type { PlaybackState } from "./playbackReducer";

/**
 * Says what a screen reader would miss while the map moves: the day, when
 * playback reaches another, and the end ("Playback ended at the last
 * recorded point, 15:02, Tuesday 3 November"). Not on entry, and not for
 * a step the person took (a seek in the same day says nothing).
 */
export function usePlaybackAnnouncer(state: PlaybackState): void {
  const announce = useAnnounce();
  const format = useFormatter();
  const { status, day, clock } = state;
  const spoken = useRef<{ day: string; ended: boolean } | null>(null);
  useEffect(() => {
    if (status === "off") {
      spoken.current = null;
      return;
    }
    const before = spoken.current;
    if (before === null) {
      spoken.current = { day, ended: status === "ended" };
      return;
    }
    if (status === "ended") {
      if (!before.ended) {
        announce(
          `Playback ended at the last recorded point, ${format.time(clock * 1000)}, ${format.dayLong(day)}`,
        );
      }
      spoken.current = { day, ended: true };
      return;
    }
    if (day !== before.day) announce(format.dayLong(day));
    spoken.current = { day, ended: false };
  }, [status, day, clock, announce, format]);
}
