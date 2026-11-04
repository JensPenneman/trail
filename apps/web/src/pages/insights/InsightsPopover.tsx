import { type ReactNode, type RefObject, useRef } from "react";
import { useDismiss } from "../../ui/useDismiss";

/**
 * A popover under its button that does not trap focus: Escape returns focus
 * to the button, a press or focus outside just closes it (useDismiss).
 */
export function InsightsPopover({
  open,
  onOpenChange,
  popoverId,
  align = "start",
  button,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  popoverId: string;
  /** Which edge of its button the popover lines up with: the last button of a row, the end. */
  align?: "start" | "end";
  /** The button, given what it needs to point at the popover. */
  button: (props: {
    ref: RefObject<HTMLButtonElement | null>;
    "aria-expanded": boolean;
    "aria-controls": string;
    onClick: () => void;
  }) => ReactNode;
  /** Gets `done`, to close the popover and hand focus back to its button. */
  children: (done: () => void) => ReactNode;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useDismiss(
    open,
    (reason) => {
      onOpenChange(false);
      if (reason === "escape") trigger.current?.focus();
    },
    root,
  );
  const done = () => {
    onOpenChange(false);
    trigger.current?.focus();
  };
  return (
    <div className="insights-popover" ref={root}>
      {button({
        ref: trigger,
        "aria-expanded": open,
        "aria-controls": popoverId,
        onClick: () => onOpenChange(!open),
      })}
      {open ? (
        <div className={`insights-popover__body insights-popover__body--${align}`} id={popoverId}>
          {children(done)}
        </div>
      ) : null}
    </div>
  );
}
