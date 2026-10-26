import { tileBounds } from "../../src/heatmap/tileMath";
import type { MapData } from "../../src/processing/mapData";
import { tileKey } from "../../src/processing/tileCover";
import {
  type FetchedWay,
  type TileAddress,
  type TileData,
  TileFetchError,
  type WaySource,
} from "../../src/processing/waySource";
import { worldMap } from "./syntheticWorld";

/**
 * Map tiles cut from hand-made map data (the synthetic world by default), the
 * way Overpass would answer for them: every way with a segment in the tile,
 * with its full shape, and the stops inside the tile. Tests can make tiles
 * fail and see which tiles were asked for; nothing touches the network.
 */
export class FixtureWaySource implements WaySource {
  readonly name = "fixture";
  readonly requested: string[] = [];
  /** Tiles that answer with an error (the key `z/x/y`). */
  readonly failing = new Set<string>();
  readonly #map: MapData;

  constructor(map: MapData = worldMap()) {
    this.#map = map;
  }

  async fetchTile(tile: TileAddress): Promise<TileData> {
    const key = tileKey(tile.z, tile.x, tile.y);
    this.requested.push(key);
    if (this.failing.has(key))
      throw new TileFetchError(`fixture tile ${key} fails`, { bytes: 100 });
    const [south, west, north, east] = tileBounds(tile.x, tile.y, tile.z);
    const overlaps = (a: readonly [number, number], b: readonly [number, number]) =>
      Math.max(a[1], b[1]) >= south &&
      Math.min(a[1], b[1]) <= north &&
      Math.max(a[0], b[0]) >= west &&
      Math.min(a[0], b[0]) <= east;
    const ways: FetchedWay[] = this.#map.ways
      .filter((way) =>
        way.geometry.some((vertex, index) => {
          const next = way.geometry[index + 1];
          return next !== undefined && overlaps(vertex, next);
        }),
      )
      .map((way) => ({
        ...way,
        tags: way.name === null ? {} : { name: way.name },
      }));
    const pois = this.#map.pois.filter(
      (poi) => poi.lat >= south && poi.lat <= north && poi.lon >= west && poi.lon <= east,
    );
    return { ways, pois, bytes: JSON.stringify({ ways, pois }).length };
  }
}
