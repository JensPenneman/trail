import type { MapView } from "../pages/map/mapViews";

/**
 * The People page's address for a page its map replaced (`/history?date=…` →
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

/**
 * The address of the People page, at home on `/` since it took in the map,
 * for its own old one (`/people?…` → `/?…`): parameters and anchor as they were.
 */
export function legacyPeoplePath(url: URL): string {
  return `/${url.search}${url.hash}`;
}
