import type { HeatScale } from "./heatScale";

/** `[west, south, east, north]` in degrees. */
export type Bounds = readonly [number, number, number, number];

export interface MapTrack {
  /** Device id; also the key for colour and ordering. */
  id: string;
  color: string;
  /** Continuous pieces of `[lon, lat]`; nothing is drawn across recording gaps. */
  segments: readonly (readonly (readonly [number, number])[])[];
}

export interface MapPosition {
  id: string;
  color: string;
  /** Palette slot, for the CSS class of the DOM marker (`device-color-…`, or `person-color-…`). */
  slot: number;
  lon: number;
  lat: number;
  /** Horizontal accuracy radius in metres, drawn as a circle. */
  accuracy: number | null;
  /**
   * The radius is a share's precision (approximate, area), not a GPS guess:
   * drawn whole, however wide, since that is all the position says.
   */
  coarse?: boolean;
  /** Pulses while the device is live. */
  live: boolean;
  /** Someone else's device: drawn as their initials in their colour instead of a dot. */
  initials?: string;
}

export interface MapPoint {
  id: string;
  color: string;
  lon: number;
  lat: number;
}

export interface MapViewState {
  bounds: Bounds;
  zoom: number;
}

/** A stop or move of the Transport level, coloured by its mode. */
export interface MapTransportSegment {
  /** The segment's id; pieces outside the timeline get a key of their own. */
  id: string;
  /** Whether clicking it opens the segment (pieces of plain track do not). */
  selectable: boolean;
  kind: "stop" | "move" | "track";
  color: string;
  /** Unsure inference nobody has confirmed: drawn with a dashed outline. */
  review: boolean;
  /** `[lon, lat]`; a stop is drawn as a dot at its first point. */
  line: readonly (readonly [number, number])[];
}

/** The heatmap's cells as the API sends them and the scale that colours them. */
export interface MapHeat {
  /** `[lon, lat, count]` of each cell's centre. */
  cells: readonly (readonly [number, number, number])[];
  /** The slippy-map level of the cells: a cell is that level's tile. */
  cellZoom: number;
  scale: HeatScale;
}
