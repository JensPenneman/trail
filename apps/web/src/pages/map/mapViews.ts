/** The views of the Map page (docs/architecture.md §14), in the order of the switch. */
const mapViews = ["live", "history", "heat"] as const;
export type MapView = (typeof mapViews)[number];

export const isMapView = (value: string | null): value is MapView =>
  value !== null && (mapViews as readonly string[]).includes(value);
