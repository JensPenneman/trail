import { type ReactNode, useId, useState } from "react";
import { Icon } from "../../ui/Icon";
import "./MapOptions.css";

interface MapOptionsProps {
  /** The current choices in a few words, on the button that opens them. */
  summary: string;
  children: ReactNode;
}

/**
 * Whose data, which devices, the map style and the tracks' level. Beside a
 * full-height map they are always open; where the map sits between the
 * controls and the details (phones, small tablets) they fold into one button,
 * so the map stays near the top.
 */
export function MapOptions({ summary, children }: MapOptionsProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className={open ? "map-options is-open" : "map-options"}>
      <button
        type="button"
        className="map-options__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="layers" />
        <span className="map-options__toggle-text">
          <span className="map-options__toggle-title">Map options</span>
          <span className="map-options__summary">{summary}</span>
        </span>
        <Icon name="chevronDown" className="map-options__chevron" />
      </button>
      <div className="map-options__body" id={bodyId}>
        {children}
      </div>
    </div>
  );
}
