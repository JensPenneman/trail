import { useEffect } from "react";
import type { Player } from "./usePlayerState";

/** Where a key belongs to the control being used, not to the player. */
function ignoresKeys(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'input, select, textarea, [contenteditable=""], [contenteditable="true"], dialog, [role="dialog"]',
    ) !== null
  );
}

/**
 * The player's keys, on the window while a player is on: Space plays and
 * pauses, Left and Right step by the speed's minutes, Shift with them goes to
 * the previous or next move, Escape leaves. They leave alone what is handled
 * already (a popover that took its Escape), anything with Ctrl, Meta or Alt,
 * inputs, dialogs and editable text, and Space on a focused button, which that
 * button takes.
 */
export function usePlayerKeys(player: Player): void {
  const on = player.state.status !== "off";
  const { controls } = player;
  useEffect(() => {
    if (!on) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (ignoresKeys(event.target)) return;
      switch (event.key) {
        case " ":
          if (event.target instanceof Element && event.target.closest("button, a, summary")) return;
          controls.toggle();
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          if (event.shiftKey) controls.stepMove(direction);
          else controls.step(direction);
          break;
        }
        case "Escape":
          if (event.shiftKey) return;
          controls.exit();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, controls]);
}
