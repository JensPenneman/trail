/** The views of the People page's map (docs/architecture.md §14), in the order of the switch. */
const mapViews = ["live", "history", "heat"] as const;
export type MapView = (typeof mapViews)[number];

export const isMapView = (value: string | null): value is MapView =>
  value !== null && (mapViews as readonly string[]).includes(value);

/**
 * The views there are for whom the map shows: Heat only while the signed-in
 * person is among them, since a heatmap covers one's own devices and nobody
 * shares theirs.
 */
export function viewsFor(meShown: boolean): readonly MapView[] {
  return meShown ? mapViews : mapViews.filter((view) => view !== "heat");
}

/**
 * The view to show: the one the URL names while there is one, else Live. The
 * URL keeps its view, so choosing Me again brings Heat back.
 */
export function shownView(view: MapView, meShown: boolean): MapView {
  return viewsFor(meShown).includes(view) ? view : "live";
}
