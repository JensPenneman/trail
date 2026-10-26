import type { OsmPoi, OsmWay } from "./mapData";

/** A map tile's ways and stops as a way source delivers them. */
export interface TileData {
  ways: FetchedWay[];
  pois: OsmPoi[];
  /** Size of the download, for the daily budget (0 for local sources). */
  bytes: number;
}

/** A way with the OSM tags Trail keeps (highway, railway, service, maxspeed, name, route, public_transport, oneway). */
export interface FetchedWay extends OsmWay {
  tags: Record<string, string>;
}

export interface TileAddress {
  z: number;
  x: number;
  y: number;
}

/**
 * Where map data comes from (docs/architecture.md §17.3): OpenStreetMap
 * through Overpass by default; a self-hosted extract can implement the same
 * interface, and the tests use a hand-made one. A source throws
 * `TileFetchError` when a tile cannot be had right now.
 */
export interface WaySource {
  /** For the log: "overpass", "fixture" … */
  readonly name: string;
  fetchTile(tile: TileAddress, signal: AbortSignal): Promise<TileData>;
}

/** A tile that could not be fetched; `bytes` were downloaded anyway (they count towards the budget). */
export class TileFetchError extends Error {
  readonly bytes: number;

  constructor(message: string, options: { bytes?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TileFetchError";
    this.bytes = options.bytes ?? 0;
  }
}
