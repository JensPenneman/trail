import { tileBounds } from "../heatmap/tileMath";
import { parseTileKey, type TileKey } from "./tileCover";

/** `[lon, lat]`. */
type Position = readonly [number, number];

/**
 * A region's polygon as GeoJSON `MultiPolygon` coordinates: per polygon its
 * outline first, then its holes (`osm_regions.polygon`, structurally).
 */
export interface CoveragePolygon {
  readonly coordinates: readonly (readonly (readonly Position[])[])[];
}

/** Which z14 tiles the ready regions cover (docs/design/self-hosted-maps.md §2.5). */
export interface RegionCoverage {
  /** Whether all four corners of the tile lie inside the union of the polygons. */
  covers(key: TileKey): boolean;
  /** The tiles among `keys` that are covered. */
  covered(keys: Iterable<TileKey>): Set<TileKey>;
}

/** A ring as `lon, lat, lon, lat …`: the ray casting of thousands of edges allocates nothing. */
type FlatRing = Float64Array;

interface PreparedPolygon {
  outline: FlatRing;
  holes: readonly FlatRing[];
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const flatten = (ring: readonly Position[]): FlatRing => {
  const flat = new Float64Array(ring.length * 2);
  for (const [index, [lon, lat]] of ring.entries()) {
    flat[index * 2] = lon;
    flat[index * 2 + 1] = lat;
  }
  return flat;
};

/** Even-odd ray casting: whether (lon, lat) lies inside the ring. */
function insideRing(ring: FlatRing, lon: number, lat: number): boolean {
  let inside = false;
  const count = ring.length / 2;
  for (let index = 0, previous = count - 1; index < count; previous = index++) {
    const xi = ring[index * 2] ?? 0;
    const yi = ring[index * 2 + 1] ?? 0;
    const xj = ring[previous * 2] ?? 0;
    const yj = ring[previous * 2 + 1] ?? 0;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function prepare(polygon: CoveragePolygon): PreparedPolygon[] {
  return polygon.coordinates.map((rings) => {
    let minLon = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    for (const [lon, lat] of rings[0] ?? []) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
    const [outline = [], ...holes] = rings;
    return { outline: flatten(outline), holes: holes.map(flatten), minLon, minLat, maxLon, maxLat };
  });
}

/**
 * The coverage of a set of region polygons: a tile is covered when each of its
 * four corners lies inside *any* polygon (the union, so that neighbouring
 * regions cover the tiles on their shared border that neither covers alone),
 * outside the holes. Corners rather than the centre: an extract holds the ways
 * inside its polygon, so a border tile is half empty. Pure: polygons in,
 * answers out. A tile's answer is remembered, and so is each corner's (the
 * four tiles around a corner share it), so a commuter's tiles cost a few
 * hundred point tests however many edges the polygon has.
 */
export function regionCoverage(polygons: readonly CoveragePolygon[]): RegionCoverage {
  const prepared = polygons.flatMap(prepare);
  const tiles = new Map<TileKey, boolean>();
  const corners = new Map<string, boolean>();

  const cornerInside = (z: number, column: number, row: number, lon: number, lat: number) => {
    const key = `${z}/${column}/${row}`;
    let inside = corners.get(key);
    if (inside === undefined) {
      inside = prepared.some(
        (polygon) =>
          lon >= polygon.minLon &&
          lon <= polygon.maxLon &&
          lat >= polygon.minLat &&
          lat <= polygon.maxLat &&
          insideRing(polygon.outline, lon, lat) &&
          !polygon.holes.some((hole) => insideRing(hole, lon, lat)),
      );
      corners.set(key, inside);
    }
    return inside;
  };

  const covers = (key: TileKey): boolean => {
    const known = tiles.get(key);
    if (known !== undefined) return known;
    const tile = parseTileKey(key);
    let covered = false;
    if (tile !== null && prepared.length > 0) {
      const [south, west, north, east] = tileBounds(tile.x, tile.y, tile.z);
      // Corner (column, row) is the north-west corner of tile (column, row).
      covered =
        cornerInside(tile.z, tile.x, tile.y, west, north) &&
        cornerInside(tile.z, tile.x + 1, tile.y, east, north) &&
        cornerInside(tile.z, tile.x, tile.y + 1, west, south) &&
        cornerInside(tile.z, tile.x + 1, tile.y + 1, east, south);
    }
    tiles.set(key, covered);
    return covered;
  };

  return {
    covers,
    covered: (keys) => {
      const result = new Set<TileKey>();
      for (const key of keys) if (covers(key)) result.add(key);
      return result;
    },
  };
}
