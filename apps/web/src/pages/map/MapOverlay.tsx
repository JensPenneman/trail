import { type ReactNode, useLayoutEffect, useRef } from "react";
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
  /** Where the controls end, in px from the map's top edge: they wrap, so it is measured. */
  onMeasure: (end: number) => void;
}

/**
 * The controls that float over the map's top-left corner (docs/architecture.md
 * §14): the view switch and the map options, and under them the view's own
 * row. The map's zoom buttons keep the top-right corner. The wrapper lets
 * presses through to the map; its children take them.
 */
export function MapOverlay({
  view,
  views,
  onViewChange,
  options,
  controls,
  onMeasure,
}: MapOverlayProps) {
  const root = useRef<HTMLDivElement | null>(null);
  // Before paint: the zoom buttons, the chip and the popovers are placed from it.
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => onMeasure(element.offsetTop + element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onMeasure]);
  return (
    <div className="map-overlay" ref={root}>
      <div className="map-overlay__bar">
        <ViewSwitch view={view} views={views} onChange={onViewChange} />
        {options}
      </div>
      {controls === null ? null : <div className="map-overlay__row">{controls}</div>}
    </div>
  );
}
