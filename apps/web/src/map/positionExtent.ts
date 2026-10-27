import { circleRing } from "./circleRing";
import type { MapPosition } from "./mapTypes";

/**
 * What the camera has to take in to show a position as what it is: the point,
 * or for a coarse share's position the whole circle of its precision — framed
 * on its centre alone, the cell would fill the map and read as an exact spot.
 */
export function positionExtent(position: MapPosition): readonly (readonly [number, number])[] {
  if (position.coarse !== true || position.accuracy === null || position.accuracy <= 0) {
    return [[position.lon, position.lat]];
  }
  // North, east, south and west of the centre: the circle's bounding box.
  return circleRing(position.lon, position.lat, position.accuracy, 4);
}
