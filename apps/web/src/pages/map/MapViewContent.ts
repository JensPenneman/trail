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
 * What a view says about the map in words is the map's accessible label; the
 * sidebar has people, and the pages of Me and of someone else take what the view
 * has to say of them.
 */
export interface MapViewContent {
  /** The view's name, for the document title. */
  title: string;
  map: MapContent;
  /** The view's own controls, right below the view switch (History's day or period). */
  controls: ReactNode;
  /** The tracks' level (Live, History): what the map shows of it, for the control and legend. */
  transport: TransportMap | null;
  /** A status chip over the map ("Updating"). */
  chip: ReactNode;
  /** The key of what the map draws (Heat's colours), small over its bottom-left corner. */
  legend: ReactNode;
  /**
   * Below the map on phones, over its foot on wide screens: History's time
   * slider, or what is to be said of the day or period instead (nothing was
   * recorded, the tracks could not be loaded).
   */
  foot: ReactNode;
  /**
   * Me's timeline for the view's day (Live: today, History: the day or period),
   * in the "Timeline" group of Me's page; null for a view without one.
   * `timelineLabel` names a region around the group where the view has a name
   * for it ("Your day so far" in Live); empty for none.
   */
  timeline: ReactNode;
  timelineLabel: string;
  /**
   * The view's other group of Me's page, folded: History's "Summary, visits and
   * trips", Heat's totals and busiest places; null for Live. `meGroupTitle` is
   * the button's name.
   */
  meGroup: ReactNode;
  meGroupTitle: string;
  /**
   * The view's group of someone else's page, folded: History's summary of their
   * tracks; null where there is none.
   */
  personGroup: ReactNode;
  /**
   * The track of the person selected, if their share includes history, for the
   * view's day or period, by user id: what their page says of where they have
   * been. Nobody else is in it.
   */
  personTracks: ReadonlyMap<string, PersonTrackState>;
  /**
   * Playback: while History plays, `on` is true and `strip` is what stands in for the
   * sidebar's content ("At this moment"); null when nothing plays.
   */
  player: { on: boolean; strip: ReactNode } | null;
  /** A dialog the view opened (a stop's or move's details). */
  dialog: ReactNode;
}

export const inactiveView: MapViewContent = {
  title: "",
  map: { label: "" },
  controls: null,
  transport: null,
  chip: null,
  legend: null,
  foot: null,
  timeline: null,
  timelineLabel: "",
  meGroup: null,
  meGroupTitle: "",
  personGroup: null,
  personTracks: new Map(),
  player: null,
  dialog: null,
};
