import type { MapView } from "../pages/map/mapViews";

/**
 * The Map page's address for a page it replaced (`/history?date=…` →
 * `/?view=history&date=…`, `/explore` → `/?view=heat`): every parameter
 * carries over as it was, since the views read the same ones.
 */
export function legacyMapPath(url: URL, view: Exclude<MapView, "live">): string {
  const params = new URLSearchParams([
    ["view", view],
    ...[...new URLSearchParams(url.search)].filter(([name]) => name !== "view"),
  ]);
  return `/?${params.toString()}${url.hash}`;
}
