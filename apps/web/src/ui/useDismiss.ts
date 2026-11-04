import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * What closes a popover that does not trap focus: Escape, a press outside it,
 * or focus moving outside it (Tab past its last control, a screen reader
 * activating something else). `onDismiss` hears which: "escape" only when
 * focus is in the popover (or nowhere), so the caller can return focus to its
 * button; everything else is "outside" and leaves focus where it is. An
 * Escape that something else handled (a dialog closing) is not ours.
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
    const outside = (target: EventTarget | null) =>
      within.current !== null && target instanceof Node && !within.current.contains(target);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const root = within.current;
      if (root === null) return;
      if (
        outside(event.target) &&
        event.target instanceof Element &&
        event.target.closest('dialog, [role="dialog"]') !== null
      ) {
        return;
      }
      const active = document.activeElement;
      dismiss(
        active === null || active === document.body || root.contains(active) ? "escape" : "outside",
      );
    };
    const onPress = (event: PointerEvent) => {
      if (outside(event.target)) dismiss("outside");
    };
    const onFocus = (event: FocusEvent) => {
      if (outside(event.target)) dismiss("outside");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open, within]);
}
