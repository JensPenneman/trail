import type { Track } from "@trail/contracts/track";
import { altitudeScale, rawAltitudeColumn } from "./pathClasses";
import type { PathColouring } from "./pathColours";

/**
 * `colouring` with the classes of the altitude cut from the raw tracks drawn: whole metres in
 * steps of 1, 2 or 5 times a power of ten. Any other colouring is returned as it is.
 */
export function withAltitudeScale(
  tracks: readonly Track[],
  colouring: PathColouring,
): PathColouring {
  if (colouring.by !== "altitude") return colouring;
  const altitudes: number[] = [];
  for (const track of tracks) {
    for (const point of track.points) {
      const altitude = point[rawAltitudeColumn];
      if (typeof altitude === "number") altitudes.push(altitude);
    }
  }
  const scale = altitudeScale(altitudes);
  return scale === null ? colouring : { ...colouring, scale };
}
