import type { ReactNode } from "react";
import type { TrailMapProps } from "../../map/TrailMap";
import type { PersonTrackState } from "../../people/PersonTrackState";
import type { TransportMap } from "../../transport/useTransportMap";

/** What the page's one map draws for a view; the style and gestures are the page's. */
type MapContent = Omit<
  TrailMapProps,
  "mapStyle" | "dark" | "cooperativeGestures" | "onViewChange" | "initialView"
>;

/**
 * A view of the People page's map: what it draws on the shared map and puts
 * into each part of the page. A view that is not shown gives `inactiveView`.
 */
export interface MapViewContent {
  /** The view's name, for the document title. */
  title: string;
  /** The line under the page's heading. */
  description: ReactNode;
  map: MapContent;
  /** The view's own controls, right below the view switch (History's day or period). */
  controls: ReactNode;
  /** The tracks' level (Live, History): what the map shows of it, for the control and legend. */
  transport: TransportMap | null;
  /** A status chip over the map ("Updating"). */
  chip: ReactNode;
  /** Below the map on phones, over its foot on wide screens: History's time slider. */
  foot: ReactNode;
  panelLabel: string;
  /** The view's details: Live's (one's day so far) right under the Me card, the others' above it. */
  panel: ReactNode;
  /**
   * The tracks of the people shown whose share includes history, for the
   * view's day or period, by user id: what their cards say of where they have
   * been. Nobody else is in it.
   */
  personTracks: ReadonlyMap<string, PersonTrackState>;
  /** A dialog the view opened (a stop's or move's details). */
  dialog: ReactNode;
}

export const inactiveView: MapViewContent = {
  title: "",
  description: null,
  map: { label: "" },
  controls: null,
  transport: null,
  chip: null,
  foot: null,
  panelLabel: "",
  panel: null,
  personTracks: new Map(),
  dialog: null,
};
