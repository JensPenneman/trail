/** The views of the People page's map (docs/architecture.md §14), in the order of the switch. */
const mapViews = ["live", "history", "heat"] as const;
export type MapView = (typeof mapViews)[number];

export const isMapView = (value: string | null): value is MapView =>
  value !== null && (mapViews as readonly string[]).includes(value);

/**
 * The views there are for what the map shows: Heat while nobody or the
 * signed-in person is selected, since a heatmap covers one's own devices and
 * nobody shares theirs.
 */
export function viewsFor(heatOffered: boolean): readonly MapView[] {
  return heatOffered ? mapViews : mapViews.filter((view) => view !== "heat");
}

/**
 * The view to show: the one the URL names while there is one, else Live. The
 * URL keeps its view, so choosing Me again brings Heat back.
 */
export function shownView(view: MapView, heatOffered: boolean): MapView {
  return viewsFor(heatOffered).includes(view) ? view : "live";
}
