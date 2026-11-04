import { useEffect } from "react";
import type { TrailMapProps } from "../../src/map/TrailMap";

/** Ghent and around, as a map would report its view once it has loaded. */
const loadedView = { bounds: [3.4, 50.9, 3.9, 51.1] as const, zoom: 11 };

/** jsdom has no WebGL; page tests check what is handed to the map instead. */
export function MapStub(props: TrailMapProps) {
  const { onViewChange } = props;
  useEffect(() => onViewChange?.(loadedView), [onViewChange]);
  return (
    <div
      role="img"
      aria-label={props.label}
      data-style={typeof props.mapStyle === "string" ? props.mapStyle : "document"}
      data-dark={String(props.dark)}
      data-tracks={props.tracks?.length ?? 0}
      data-transport={props.transport?.length ?? 0}
      data-positions={props.positions?.length ?? 0}
      data-heat={props.heat?.cells.length ?? 0}
      data-fit={props.fit?.key ?? ""}
      data-fit-bounds={JSON.stringify(props.fit?.bounds ?? null)}
      data-focus={props.focus?.key ?? ""}
      data-focus-at={JSON.stringify(
        props.focus === undefined || props.focus === null
          ? null
          : [props.focus.lon, props.focus.lat],
      )}
      data-notice={props.notice ?? ""}
    />
  );
}
