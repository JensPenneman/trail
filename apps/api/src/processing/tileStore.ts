import type { WayKind } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Database, Executor } from "../db/database";
import { tileBounds } from "../heatmap/tileMath";
import { overpassSource } from "../mapdata/buildPartitions";
import { decodeGeometry, encodeGeometry } from "../mapdata/geometryCodec";
import type { MapData, OsmPoi, OsmWay, PoiKind } from "./mapData";
import { parseTileKey, type TileKey, tileKey } from "./tileCover";
import type { TileAddress, TileData } from "./waySource";

interface TileRow extends Record<string, unknown> {
  z: number;
  x: number;
  y: number;
  stale: boolean;
}

/** A way or a stop of `loadMapData`'s one statement. */
type MapRow =
  | {
      element: "way";
      id: string;
      kind: WayKind;
      nodes: string[];
      geometry: Buffer;
      name: string | null;
      lat: null;
      lon: null;
    }
  | {
      element: "poi";
      id: string;
      kind: PoiKind;
      nodes: null;
      geometry: null;
      name: string | null;
      lat: number;
      lon: number;
    };

const addresses = (keys: Iterable<TileKey>): TileAddress[] =>
  [...keys].flatMap((key) => {
    const tile = parseTileKey(key);
    return tile === null ? [] : [tile];
  });

/** Tiles fetched before this are due for a refresh (`mapping.tileMaxAgeDays`). */
export const staleBefore = (maxAgeDays: number, now: Date): Date =>
  new Date(now.getTime() - maxAgeDays * 86_400_000);

/**
 * The tiles among `keys` whose data is cached, and those of them fetched
 * before `before`: they keep serving while they are fetched again (a failed
 * refresh keeps the old data).
 */
export async function cachedTiles(
  db: Executor,
  keys: Iterable<TileKey>,
  before: Date,
): Promise<{ available: Set<TileKey>; stale: Set<TileKey> }> {
  const available = new Set<TileKey>();
  const stale = new Set<TileKey>();
  const tiles = addresses(keys);
  if (tiles.length === 0) return { available, stale };
  const result = await db.execute<TileRow>(sql`
    SELECT t.z, t.x, t.y, t.fetched_at < ${before.toISOString()}::timestamptz AS stale
    FROM jsonb_to_recordset(${JSON.stringify(tiles)}::jsonb) AS r(z smallint, x integer, y integer)
    JOIN osm_tiles t ON t.z = r.z AND t.x = r.x AND t.y = r.y
    WHERE t.status = 'ok'
  `);
  for (const row of result.rows) {
    const key = tileKey(row.z, row.x, row.y);
    available.add(key);
    if (row.stale) stale.add(key);
  }
  return { available, stale };
}

/**
 * The ways and stops of the tiles among `keys`, from every source that serves
 * (docs/architecture.md §17.3): the Overpass cache and the ready build of each
 * imported region. A way or stop that two of them hold comes once, from the
 * one with the newer data (`fetched_at`: when Overpass sent it, or the
 * region's extract; then the source), so the answer never depends on the
 * order of the rows. One statement, so one moment: a region's build swapped
 * meanwhile is read old or new, never both or neither (importRegion.ts).
 */
export async function loadMapData(db: Executor, keys: Iterable<TileKey>): Promise<MapData> {
  const tiles = addresses(keys);
  if (tiles.length === 0) return { ways: [], pois: [] };
  const result = await db.execute<MapRow & Record<string, unknown>>(sql`
    WITH tiles AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(tiles)}::jsonb) AS r(z smallint, x integer, y integer)
    ),
    serving AS MATERIALIZED (
      SELECT ${overpassSource}::text AS source
      UNION ALL
      SELECT source FROM osm_regions WHERE status = 'ready'
    ),
    ways AS (
      SELECT DISTINCT ON (w.id) w.id, w.kind, w.nodes, w.geometry, w.tags->>'name' AS name
      FROM tiles r
      JOIN osm_tile_ways tw ON tw.z = r.z AND tw.x = r.x AND tw.y = r.y
        AND tw.source = ANY (ARRAY(SELECT source FROM serving))
      JOIN osm_ways w ON w.id = tw.way_id AND w.source = tw.source
      ORDER BY w.id, w.fetched_at DESC, w.source DESC
    ),
    pois AS (
      SELECT DISTINCT ON (p.id) p.id, p.kind, p.lat, p.lon, p.name
      FROM tiles r
      JOIN osm_pois p ON p.z = r.z AND p.x = r.x AND p.y = r.y
        AND p.source = ANY (ARRAY(SELECT source FROM serving))
      ORDER BY p.id, p.fetched_at DESC, p.source DESC
    )
    SELECT 'way' AS element, id::text AS id, kind, nodes::text[] AS nodes, geometry, name,
      NULL::double precision AS lat, NULL::double precision AS lon
    FROM ways
    UNION ALL
    SELECT 'poi', id, kind, NULL, NULL, name, lat, lon FROM pois
  `);
  const ways: OsmWay[] = [];
  const pois: OsmPoi[] = [];
  for (const row of result.rows) {
    if (row.element === "way") {
      ways.push({
        id: Number(row.id),
        kind: row.kind,
        nodes: row.nodes.map(Number),
        geometry: decodeGeometry(row.geometry),
        name: row.name,
      });
    } else {
      pois.push({ id: row.id, kind: row.kind, lat: row.lat, lon: row.lon, name: row.name });
    }
  }
  return { ways, pois };
}

/**
 * Stores a fetched tile in one transaction, in the Overpass cache's partition
 * (`source` overpass): its ways (shared with neighbouring tiles, so upserted)
 * with their compact geometry, which ways it contains, its stops, and the
 * tile row. Ways that no tile contains any more are dropped.
 */
export async function saveTile(
  db: Database,
  tile: TileAddress,
  data: TileData,
  now: Date,
): Promise<void> {
  const fetchedAt = now.toISOString();
  const ways = data.ways.map((way) => {
    let minLat = Number.POSITIVE_INFINITY;
    let minLon = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    for (const [lon, lat] of way.geometry) {
      minLat = Math.min(minLat, lat);
      minLon = Math.min(minLon, lon);
      maxLat = Math.max(maxLat, lat);
      maxLon = Math.max(maxLon, lon);
    }
    return {
      id: way.id,
      kind: way.kind,
      tags: way.tags,
      nodes: way.nodes,
      geometry: encodeGeometry(way.geometry).toString("hex"),
      min_lat: minLat,
      min_lon: minLon,
      max_lat: maxLat,
      max_lon: maxLon,
    };
  });
  const [south, west, north, east] = tileBounds(tile.x, tile.y, tile.z);
  // A stop on the tile's edge comes with both tiles; it belongs to the one it lies in.
  const pois = data.pois.filter(
    (poi) => poi.lat >= south && poi.lat < north && poi.lon >= west && poi.lon < east,
  );
  await db.transaction(async (tx) => {
    const previous = await tx.execute<{ way_id: string }>(sql`
      DELETE FROM osm_tile_ways
      WHERE source = ${overpassSource} AND z = ${tile.z} AND x = ${tile.x} AND y = ${tile.y}
      RETURNING way_id::text
    `);
    if (ways.length > 0) {
      await tx.execute(sql`
        INSERT INTO osm_ways (id, source, kind, tags, nodes, geometry, min_lat, min_lon, max_lat, max_lon, fetched_at)
        SELECT id, ${overpassSource}, kind, tags, ARRAY(SELECT jsonb_array_elements_text(nodes))::bigint[],
          decode(geometry, 'hex'), min_lat, min_lon, max_lat, max_lon, ${fetchedAt}::timestamptz
        FROM jsonb_to_recordset(${JSON.stringify(ways)}::jsonb) AS r(
          id bigint, kind text, tags jsonb, nodes jsonb, geometry text,
          min_lat double precision, min_lon double precision, max_lat double precision, max_lon double precision
        )
        ON CONFLICT (id, source) DO UPDATE SET
          kind = excluded.kind, tags = excluded.tags, nodes = excluded.nodes,
          geometry = excluded.geometry, min_lat = excluded.min_lat, min_lon = excluded.min_lon,
          max_lat = excluded.max_lat, max_lon = excluded.max_lon, fetched_at = excluded.fetched_at
      `);
      await tx.execute(sql`
        INSERT INTO osm_tile_ways (z, x, y, way_id, source)
        SELECT ${tile.z}, ${tile.x}, ${tile.y}, id, ${overpassSource}
        FROM jsonb_to_recordset(${JSON.stringify(ways.map(({ id }) => ({ id })))}::jsonb) AS r(id bigint)
      `);
    }
    const gone = previous.rows.map((row) => row.way_id);
    if (gone.length > 0) {
      await tx.execute(sql`
        DELETE FROM osm_ways w
        WHERE w.source = ${overpassSource} AND w.id = ANY(${`{${gone.join(",")}}`}::bigint[])
          AND NOT EXISTS (
            SELECT 1 FROM osm_tile_ways t WHERE t.source = ${overpassSource} AND t.way_id = w.id
          )
      `);
    }
    await tx.execute(
      sql`DELETE FROM osm_pois WHERE source = ${overpassSource} AND z = ${tile.z} AND x = ${tile.x} AND y = ${tile.y}`,
    );
    if (pois.length > 0) {
      await tx.execute(sql`
        INSERT INTO osm_pois (id, source, kind, lat, lon, name, z, x, y, fetched_at)
        SELECT id, ${overpassSource}, kind, lat, lon, name, ${tile.z}, ${tile.x}, ${tile.y}, ${fetchedAt}::timestamptz
        FROM jsonb_to_recordset(${JSON.stringify(pois)}::jsonb) AS r(
          id text, kind text, lat double precision, lon double precision, name text
        )
        ON CONFLICT (id, source) DO UPDATE SET
          kind = excluded.kind, lat = excluded.lat, lon = excluded.lon, name = excluded.name,
          z = excluded.z, x = excluded.x, y = excluded.y, fetched_at = excluded.fetched_at
      `);
    }
    await tx.execute(sql`
      INSERT INTO osm_tiles (z, x, y, status, fetched_at, way_count, poi_count, bytes, failures, retry_at)
      VALUES (${tile.z}, ${tile.x}, ${tile.y}, 'ok', ${fetchedAt}::timestamptz, ${ways.length},
        ${pois.length}, ${data.bytes}, 0, NULL)
      ON CONFLICT (z, x, y) DO UPDATE SET
        status = 'ok', fetched_at = excluded.fetched_at, way_count = excluded.way_count,
        poi_count = excluded.poi_count, bytes = excluded.bytes, failures = 0, retry_at = NULL
    `);
  });
}

/**
 * Records a failed fetch: a tile without data is retried later (10 minutes,
 * then four times longer each time, at most a day); a cached tile whose
 * refresh failed keeps its data.
 */
export async function recordTileFailure(
  db: Executor,
  tile: TileAddress,
  bytes: number,
  now: Date,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO osm_tiles (z, x, y, status, fetched_at, way_count, poi_count, bytes, failures, retry_at)
    VALUES (${tile.z}, ${tile.x}, ${tile.y}, 'failed', ${now.toISOString()}::timestamptz, 0, 0, ${bytes},
      1, ${now.toISOString()}::timestamptz + interval '10 minutes')
    ON CONFLICT (z, x, y) DO UPDATE SET
      failures = osm_tiles.failures + 1,
      bytes = CASE WHEN osm_tiles.status = 'ok' THEN osm_tiles.bytes ELSE excluded.bytes END,
      fetched_at = CASE WHEN osm_tiles.status = 'ok' THEN osm_tiles.fetched_at ELSE excluded.fetched_at END,
      retry_at = excluded.fetched_at + least(interval '1 day', interval '10 minutes' * power(4, osm_tiles.failures))
  `);
}

/** Bytes downloaded since the start of the UTC day (the daily budget). */
export async function bytesFetchedToday(db: Executor, now: Date): Promise<number> {
  const result = await db.execute<{ bytes: string | null }>(sql`
    SELECT sum(bytes)::text AS bytes FROM osm_tiles
    WHERE fetched_at >= date_trunc('day', ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  `);
  return Number(result.rows[0]?.bytes ?? 0);
}
