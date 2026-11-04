import { type ReactNode, useRef } from "react";
import { Icon } from "../../../ui/Icon";
import { useDismiss } from "../../../ui/useDismiss";
import "./PeriodControl.css";

interface PeriodControlProps {
  /** The day or period shown, on the button. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  popoverId: string;
  /** What the popover holds: the choice of day or period and its calendar or form. */
  children: ReactNode;
}

/**
 * The date button of History's controls and the popover it opens. Like the map
 * options it does not trap focus: Escape closes it and returns focus to the
 * button, a press outside just closes it.
 */
export function PeriodControl({
  label,
  open,
  onOpenChange,
  popoverId,
  children,
}: PeriodControlProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  useDismiss(
    open,
    (reason) => {
      onOpenChange(false);
      if (reason === "escape") button.current?.focus();
    },
    root,
  );
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
        <div className="period-control__popover" id={popoverId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
