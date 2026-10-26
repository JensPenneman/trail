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

/**
 * Why a tile could not be had, in words that say nothing about where it is:
 * the log names only this above debug level (docs/architecture.md §12).
 */
export type TileFetchReason =
  /** No connection, or it broke off. */
  | "unreachable"
  /** An error status (in `status`). */
  | "status"
  | "timeout"
  | "too_large"
  | "not_json"
  /** An answer Trail cannot read. */
  | "malformed"
  /** The source gave up on the query (Overpass: a remark about a runtime error). */
  | "incomplete"
  /** The source has no data for the tile. */
  | "unavailable";

/**
 * A tile that could not be fetched; `bytes` were downloaded anyway (they
 * count towards the budget). The message may name ways or the tile: it is
 * logged at debug level only.
 */
export class TileFetchError extends Error {
  readonly reason: TileFetchReason;
  /** The HTTP status, for reason `status`. */
  readonly status: number | null;
  readonly bytes: number;

  constructor(
    message: string,
    options: { reason: TileFetchReason; status?: number; bytes?: number; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TileFetchError";
    this.reason = options.reason;
    this.status = options.status ?? null;
    this.bytes = options.bytes ?? 0;
  }
}
