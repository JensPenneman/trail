import { decodeGeometry, encodeGeometry } from "../../src/mapdata/geometryCodec";
import type { MapData } from "../../src/processing/mapData";

/** Map data as `loadMapData` reads it back from `osm_ways`: every position rounded to 1e-7 degrees. */
export const throughOsmWays = (map: MapData): MapData => ({
  ...map,
  ways: map.ways.map((way) => ({ ...way, geometry: decodeGeometry(encodeGeometry(way.geometry)) })),
});
