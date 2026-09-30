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
  /** Palette slot, for the CSS class of the DOM marker. */
  slot: number;
  lon: number;
  lat: number;
  /** Horizontal accuracy radius in metres, drawn as a circle. */
  accuracy: number | null;
  /** Pulses while the device is live. */
  live: boolean;
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
