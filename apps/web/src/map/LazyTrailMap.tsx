import { lazy, Suspense } from "react";
import { Spinner } from "../ui/Spinner";
import { MapErrorBoundary } from "./MapErrorBoundary";
import type { TrailMapProps } from "./TrailMap";
import "./LazyTrailMap.css";

const TrailMap = lazy(() => import("./TrailMap").then((module) => ({ default: module.TrailMap })));

/** The map, loaded on demand: MapLibre is by far the largest dependency and only these views use it. */
export function LazyTrailMap(props: TrailMapProps) {
  return (
    <MapErrorBoundary>
      <Suspense
        fallback={
          <div className="map-loading">
            <Spinner label="Loading the map" />
          </div>
        }
      >
        <TrailMap {...props} />
      </Suspense>
    </MapErrorBoundary>
  );
}
