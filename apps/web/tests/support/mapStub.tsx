import type { TrailMapProps } from "../../src/map/TrailMap";

/** jsdom has no WebGL; page tests check what is handed to the map instead. */
export function MapStub(props: TrailMapProps) {
  return (
    <div
      role="img"
      aria-label={props.label}
      data-tracks={props.tracks?.length ?? 0}
      data-positions={props.positions?.length ?? 0}
      data-heat={props.heat?.length ?? 0}
    />
  );
}
