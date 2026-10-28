import type { WayKind } from "@trail/contracts/transport";
import { classifyWay } from "../processing/classifyWay";
import { encodeFixedGeometry } from "./geometryCodec";
import { MapDataError } from "./mapDataError";
import { parseOplWay } from "./parseOplWay";
import { wayTiles } from "./wayTiles";

/** A way as `osm_ways` and `osm_tile_ways` store it. */
export interface WayRow {
  id: number;
  kind: WayKind;
  tags: Record<string, string>;
  nodes: number[];
  /** The compact geometry (geometryCodec.ts). */
  geometry: Buffer;
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
  /** The z14 tiles its segments pass through (`tileNumber` keys). */
  tiles: Set<number>;
}

/** What the lines of ways.opl.gz held so far. */
export interface WayCounts {
  lines: number;
  ways: number;
  /** Node references of every readable line, as the manifest counts them. */
  nodeRefs: number;
  memberships: number;
  /** Lines that are no readable way, or a way beyond the limits: dropped. */
  malformed: number;
  /** Ways that are no road, path, railway or ferry (`classifyWay` gives null): dropped. */
  unclassified: number;
  kinds: Partial<Record<WayKind, number>>;
  /** The highest way id so far: osmium writes the ways in id order. */
  lastId: number;
}

export const emptyWayCounts = (): WayCounts => ({
  lines: 0,
  ways: 0,
  nodeRefs: 0,
  memberships: 0,
  malformed: 0,
  unclassified: 0,
  kinds: {},
  lastId: 0,
});

/**
 * The ways of some lines of ways.opl.gz, classified by `classifyWay` (the
 * mapped level's version stays: the same kinds as from Overpass), with their
 * bounding box and z14 tiles; `counts` keeps the tally across calls. A way id
 * that is not above the one before means the file is not osmium's (a
 * duplicate, or out of order): the import stops.
 */
export function* wayRows(lines: readonly string[], counts: WayCounts): Generator<WayRow> {
  for (const line of lines) {
    counts.lines += 1;
    const parsed = parseOplWay(line);
    if (!parsed.ok) {
      counts.malformed += 1;
      continue;
    }
    const { id, tags, nodes, lonLatE7 } = parsed.way;
    if (id <= counts.lastId) {
      throw new MapDataError(
        `ways.opl.gz is not in way id order: way ${id} after way ${counts.lastId} (a duplicate, or not osmium's output)`,
      );
    }
    counts.lastId = id;
    counts.nodeRefs += nodes.length;
    const kind = classifyWay(tags);
    if (kind === null) {
      counts.unclassified += 1;
      continue;
    }
    const tiles = wayTiles(lonLatE7);
    if (tiles === null) {
      counts.malformed += 1;
      continue;
    }
    let minLon = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < lonLatE7.length; index += 2) {
      const lon = lonLatE7[index] ?? 0;
      const lat = lonLatE7[index + 1] ?? 0;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    counts.ways += 1;
    counts.memberships += tiles.size;
    counts.kinds[kind] = (counts.kinds[kind] ?? 0) + 1;
    yield {
      id,
      kind,
      tags,
      nodes,
      geometry: encodeFixedGeometry(lonLatE7),
      minLat: minLat / 1e7,
      minLon: minLon / 1e7,
      maxLat: maxLat / 1e7,
      maxLon: maxLon / 1e7,
      tiles,
    };
  }
}
