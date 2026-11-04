import type { ReactNode } from "react";
import type { MapView } from "./mapViews";
import { ViewSwitch } from "./ViewSwitch";
import "./MapOverlay.css";

interface MapOverlayProps {
  view: MapView;
  views: readonly MapView[];
  onViewChange: (view: MapView) => void;
  /** The map options button with its popover. */
  options: ReactNode;
  /** The view's own row (History's day or period), under the bar. */
  controls: ReactNode;
}

/**
 * The controls that float over the map's top-left corner (docs/architecture.md
 * §14): the view switch and the map options, and under them the view's own
 * row. The map's zoom buttons keep the top-right corner. The wrapper lets
 * presses through to the map; its children take them.
 */
export function MapOverlay({ view, views, onViewChange, options, controls }: MapOverlayProps) {
  return (
    <div className="map-overlay">
      <div className="map-overlay__bar">
        <ViewSwitch view={view} views={views} onChange={onViewChange} />
        {options}
      </div>
      {controls === null ? null : <div className="map-overlay__row">{controls}</div>}
    </div>
  );
}
