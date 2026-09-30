import type { HeatmapParams } from "../api/queryKeys";
import type { MapViewState } from "./mapTypes";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * The heatmap request for a map view: the box is rounded outward to a
 * thousandth of a degree and the zoom to whole levels (the server picks its
 * cell size from the rounded zoom anyway), so small pans hit the cache. World
 * copies beyond ±180° are clamped to what the API accepts.
 */
export function heatmapParamsFor(
  view: MapViewState,
  deviceIds: readonly string[] | null,
): HeatmapParams {
  const [west, south, east, north] = view.bounds;
  const down = (value: number) => Math.floor(value * 1000) / 1000;
  const up = (value: number) => Math.ceil(value * 1000) / 1000;
  const box = [
    clamp(down(west), -180, 180),
    clamp(down(south), -90, 90),
    clamp(up(east), -180, 180),
    clamp(up(north), -90, 90),
  ];
  return { bbox: box.join(","), zoom: clamp(Math.round(view.zoom), 0, 24), deviceIds };
}
