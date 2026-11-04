import type { MapViewState } from "./mapTypes";

/** MapLibre draws the world 512 px wide at zoom 0. */
const worldPx = 512;

const mercatorY = (lat: number): number => {
  const radians = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
};

/**
 * Whether the map has left the camera a link named (`?c=`): its zoom differs by more than a
 * hundredth, or its centre by more than two pixels at that zoom. A map that has only arrived at
 * the camera (its bounds report the same view) has not left it.
 */
export function cameraDiffers(
  camera: { lon: number; lat: number; zoom: number },
  view: MapViewState,
): boolean {
  if (Math.abs(view.zoom - camera.zoom) > 0.01) return true;
  const [west, south, east, north] = view.bounds;
  const scale = worldPx * 2 ** view.zoom;
  const dx = (((west + east) / 2 - camera.lon) / 360) * scale;
  const dy = ((mercatorY(north) + mercatorY(south)) / 2 - mercatorY(camera.lat)) * scale;
  return Math.hypot(dx, dy) > 2;
}
