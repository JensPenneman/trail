import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * What closes a popover that does not trap focus: Escape, or a press outside
 * it. `onDismiss` hears which, so Escape can return focus to the button that
 * opened it while a press elsewhere leaves focus where the person put it.
 * Listens only while `open`; `within` is the popover with its button.
 */
export function useDismiss(
  open: boolean,
  onDismiss: (reason: "escape" | "outside") => void,
  within: RefObject<HTMLElement | null>,
): void {
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss("escape");
    };
    const onPress = (event: PointerEvent) => {
      const root = within.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        dismiss("outside");
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open, within]);
}
