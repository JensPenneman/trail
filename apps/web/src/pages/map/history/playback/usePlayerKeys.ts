import { useEffect } from "react";
import type { Player } from "./usePlayerState";

/**
 * Where a key belongs to the control being used, not to the player. The bar's
 * own range, radios and switch are not such controls for Space and Escape —
 * only for the keys they use themselves (a range its arrows; a radio or
 * switch its Space).
 */
function ignoresKeys(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('dialog, [role="dialog"], [role="alertdialog"]') !== null) return true;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])'))
  ) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    const control = target.type;
    if (key === "Escape") return !["range", "radio", "checkbox"].includes(control);
    if (key === " ") return control !== "range";
    return true;
  }
  return target.closest("select, textarea") !== null;
}

/**
 * The player's keys, on the window while a player is on: Space plays and
 * pauses, Left and Right step by the speed's minutes, Shift with them goes to
 * the previous or next move, Escape leaves. They leave alone what is handled
 * already (a popover that took its Escape), anything with Ctrl, Meta or Alt,
 * inputs, dialogs and editable text (not the bar's own range, radios and
 * switch, for Space and Escape), a held Space or Escape, and Space on a focused
 * button, which that button takes.
 */
export function usePlayerKeys(player: Player): void {
  const on = player.state.status !== "off";
  const { controls } = player;
  useEffect(() => {
    if (!on) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (ignoresKeys(event.target, event.key)) return;
      // A held key is one press: Space would otherwise play and pause as long as it is down.
      if (event.repeat && (event.key === " " || event.key === "Escape")) return;
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
