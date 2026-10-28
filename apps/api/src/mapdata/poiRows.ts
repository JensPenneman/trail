import { z } from "zod";
import { latToTileY, lonToTileX } from "../heatmap/tileMath";
import { classifyPoi } from "../processing/classifyPoi";
import type { PoiKind } from "../processing/mapData";
import { tileZoom } from "./wayTiles";

/** A stop as `osm_pois` stores it. */
export interface PoiRow {
  /** `n<id>`, `w<id>` or `r<id>`: the OSM element, as Overpass names it. */
  id: string;
  kind: PoiKind;
  lat: number;
  lon: number;
  name: string | null;
  /** The z14 tile it lies in. */
  x: number;
  y: number;
}

/** What the lines of pois.geojsonseq.gz held so far. */
export interface PoiCounts {
  features: number;
  pois: number;
  /** Lines that are no readable feature: dropped. */
  malformed: number;
  /** Features that are no stop or airport (`classifyPoi` gives null): dropped. */
  unclassified: number;
  kinds: Partial<Record<PoiKind, number>>;
}

export const emptyPoiCounts = (): PoiCounts => ({
  features: 0,
  pois: 0,
  malformed: 0,
  unclassified: 0,
  kinds: {},
});

/** The tags `classifyPoi` reads, and the name: nothing else of a feature is kept. */
const poiTagKeys = [
  "railway",
  "station",
  "subway",
  "highway",
  "amenity",
  "aeroway",
  "name",
] as const;
const elementTypes = { node: "n", way: "w", relation: "r" } as const;

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(position).min(1).max(100_000);
const featureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("Point"), coordinates: position }),
    z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1).max(10_000) }),
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(z.array(ring).min(1).max(10_000)).min(1).max(10_000),
    }),
  ]),
  properties: z
    .object({
      "@type": z.enum(["node", "way", "relation"]),
      "@id": z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .catchall(z.unknown()),
});

/** The centre of the bounding box over every ring: Overpass's `out center`, not the centroid. */
function boxCentre(
  polygons: readonly (readonly (readonly [number, number])[])[],
): [number, number] {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const rings of polygons) {
    for (const [lon, lat] of rings) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return [(west + east) / 2, (south + north) / 2];
}

/**
 * The stops of some lines of pois.geojsonseq.gz (`osmium export -f
 * geojsonseq`, a record separator before each feature), classified by
 * `classifyPoi` as Overpass's are: a point keeps its position, an area
 * (osmium writes every area as a MultiPolygon; a Polygon is read the same
 * way) becomes the centre of the bounding box over all its rings, and the id
 * comes from `@type` and `@id`, the OSM element — the feature's own id is
 * osmium's area number. `counts` keeps the tally across calls.
 */
export function* poiRows(lines: readonly string[], counts: PoiCounts): Generator<PoiRow> {
  for (const raw of lines) {
    const line = raw.charCodeAt(0) === 0x1e ? raw.slice(1) : raw;
    if (line.trim().length === 0) continue;
    counts.features += 1;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      counts.malformed += 1;
      continue;
    }
    const parsed = featureSchema.safeParse(json);
    if (!parsed.success) {
      counts.malformed += 1;
      continue;
    }
    const { geometry, properties } = parsed.data;
    const tags: Record<string, string> = {};
    for (const key of poiTagKeys) {
      const value = Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (typeof value === "string") tags[key] = value;
    }
    const name = tags["name"] ?? null;
    if (name?.includes("\u0000")) {
      counts.malformed += 1;
      continue;
    }
    const kind = classifyPoi(tags);
    if (kind === null) {
      counts.unclassified += 1;
      continue;
    }
    const [lon, lat] =
      geometry.type === "Point"
        ? geometry.coordinates
        : boxCentre(
            geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat(),
          );
    counts.pois += 1;
    counts.kinds[kind] = (counts.kinds[kind] ?? 0) + 1;
    yield {
      id: `${elementTypes[properties["@type"]]}${properties["@id"]}`,
      kind,
      lat,
      lon,
      name,
      x: lonToTileX(lon, tileZoom),
      y: latToTileY(lat, tileZoom),
    };
  }
}
