import { useEffect, useRef } from "react";
import type { MapViewState } from "../../src/map/mapTypes";
import type { TrailMapProps } from "../../src/map/TrailMap";

/** Ghent and around, as a map would report its view once it has loaded. */
const loadedView = { bounds: [3.4, 50.9, 3.9, 51.1] as const, zoom: 11 };

/** The view change handler of the latest stub, for a test to report another view as a moved map would. */
let latestReport: ((view: MapViewState) => void) | null = null;
export const stubMap = {
  report: (view: MapViewState) => latestReport?.(view),
};

/** jsdom has no WebGL; page tests check what is handed to the map instead. */
export function MapStub(props: TrailMapProps) {
  const { onViewChange, initialView } = props;
  latestReport = onViewChange ?? null;
  // How often the tracks were handed over as another array: the real map redraws them each time.
  const tracksSeen = useRef({ tracks: props.tracks, updates: 0 });
  if (tracksSeen.current.tracks !== props.tracks) {
    tracksSeen.current = { tracks: props.tracks, updates: tracksSeen.current.updates + 1 };
  }
  // As a real map reports its view once loaded: where it was told to start, else Ghent.
  useEffect(() => {
    if (initialView === undefined) {
      onViewChange?.(loadedView);
      return;
    }
    const [lon, lat] = initialView.center;
    // Symmetric around the centre in the map's own (Mercator) space, as a real map's bounds are.
    const y = (degrees: number) => Math.log(Math.tan(Math.PI / 4 + (degrees * Math.PI) / 360));
    const degrees = (value: number) =>
      ((2 * Math.atan(Math.exp(value)) - Math.PI / 2) * 180) / Math.PI;
    const half = (y(lat + 0.1) - y(lat - 0.1)) / 2;
    onViewChange?.({
      bounds: [lon - 0.2, degrees(y(lat) - half), lon + 0.2, degrees(y(lat) + half)],
      zoom: initialView.zoom,
    });
  }, [onViewChange, initialView]);
  return (
    <div
      role="img"
      aria-label={props.label}
      data-style={typeof props.mapStyle === "string" ? props.mapStyle : "document"}
      data-dark={String(props.dark)}
      data-tracks={props.tracks?.length ?? 0}
      data-track-updates={tracksSeen.current.updates}
      data-transport={props.transport?.length ?? 0}
      data-positions={props.positions?.length ?? 0}
      aria-describedby={props.describedBy}
      data-heat={props.heat?.cells.length ?? 0}
      data-initial-view={JSON.stringify(props.initialView ?? null)}
      data-fit={props.fit?.key ?? ""}
      data-fit-bounds={JSON.stringify(props.fit?.bounds ?? null)}
      data-focus={props.focus?.key ?? ""}
      data-focus-at={JSON.stringify(
        props.focus === undefined || props.focus === null
          ? null
          : [props.focus.lon, props.focus.lat],
      )}
      data-follow={props.follow?.map((point) => `${point.lon},${point.lat}`).join(";") ?? ""}
      data-dimmed={
        (props.tracks?.filter((track) => track.dimmed === true).length ?? 0) +
        (props.transport?.filter((segment) => segment.dimmed === true).length ?? 0)
      }
      data-notice={props.notice ?? ""}
    />
  );
}
