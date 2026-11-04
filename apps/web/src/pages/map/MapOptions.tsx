import { type ReactNode, useId, useRef, useState } from "react";
import { Icon } from "../../ui/Icon";
import { useDismiss } from "../../ui/useDismiss";
import "./MapOptions.css";

interface MapOptionsProps {
  /** The current choices in a few words, at the top of the popover. */
  summary: string;
  children: ReactNode;
}

/**
 * The map's options (style, the tracks' detail and legend, the devices) in a
 * popover that opens from a button over the map. It does not trap focus: the
 * map stays usable beside it, and Escape or a press outside closes it (Escape
 * returns focus to the button). The body stays in the document while closed
 * and is hidden by CSS only, so what is in it keeps its place in the tree.
 */
export function MapOptions({ summary, children }: MapOptionsProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  useDismiss(
    open,
    (reason) => {
      setOpen(false);
      if (reason === "escape") button.current?.focus();
    },
    root,
  );
  return (
    <div className={open ? "map-options is-open" : "map-options"} ref={root}>
      <button
        type="button"
        className="map-options__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        ref={button}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="layers" />
        <span>Map options</span>
      </button>
      <div className="map-options__body" id={bodyId}>
        <p className="map-options__summary">{summary}</p>
        {children}
      </div>
    </div>
  );
}
