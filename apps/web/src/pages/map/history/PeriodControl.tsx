import { type ReactNode, useEffect, useRef } from "react";
import { Icon } from "../../../ui/Icon";
import { useDismiss } from "../../../ui/useDismiss";
import "../MapPopover.css";
import "./PeriodControl.css";

interface PeriodControlProps {
  /** The day or period shown, on the button. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  popoverId: string;
  /** Opened from elsewhere on the page: focus goes in, to the day that is shown. */
  focusIn?: boolean;
  /**
   * What the popover holds: the choice of day or period and its calendar or
   * form. It gets `done`, to close the popover once something was chosen.
   */
  children: (done: () => void) => ReactNode;
}

/**
 * The date button of History's controls and the popover it opens. Like the map
 * options it does not trap focus. Every way of closing it from inside (Escape,
 * a day or period chosen) returns focus to the button, so it never falls to the
 * page; a press or focus outside just closes it.
 */
export function PeriodControl({
  label,
  open,
  onOpenChange,
  popoverId,
  focusIn = false,
  children,
}: PeriodControlProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);
  const done = () => {
    onOpenChange(false);
    button.current?.focus();
  };
  useDismiss(
    open,
    (reason) => {
      onOpenChange(false);
      if (reason === "escape") button.current?.focus();
    },
    root,
  );
  useEffect(() => {
    if (!open || !focusIn) return;
    const target =
      popover.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      popover.current?.querySelector<HTMLElement>("button, input");
    target?.focus();
  }, [open, focusIn]);
  return (
    <div className="period-control" ref={root}>
      <button
        type="button"
        className="period-control__date"
        aria-expanded={open}
        aria-controls={popoverId}
        ref={button}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="calendar" />
        <span className="period-control__label">{label}</span>
        <span className="visually-hidden">, choose another day</span>
        <Icon name="chevronDown" className="period-control__chevron" />
      </button>
      {open ? (
        <div className="period-control__popover map-popover" id={popoverId} ref={popover}>
          {children(done)}
        </div>
      ) : null}
    </div>
  );
}
