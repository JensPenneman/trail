import { Component, type ReactNode } from "react";
import "./LazyTrailMap.css";

interface MapErrorBoundaryState {
  failed: boolean;
}

/**
 * If the map code cannot load (an old tab after a deploy, a network hiccup)
 * the page stays usable: everything on the map is also listed as text.
 * Error boundaries still have to be class components.
 */
export class MapErrorBoundary extends Component<{ children: ReactNode }, MapErrorBoundaryState> {
  override state: MapErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="map-loading">
        <p className="map-loading__message">
          The map could not be loaded. Reload the page to try again — the details are listed on this
          page as well.
        </p>
      </div>
    );
  }
}
