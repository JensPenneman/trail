import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/db/database";
import { runMigrations } from "../../src/db/runMigrations";
import { decodeGeometry } from "../../src/mapdata/geometryCodec";
import { loadMapData } from "../../src/processing/tileStore";
import { folderUpTo, tagBefore } from "../support/migrationFolders";
import { migrationsFolder, resetDatabase, wipeTestDatabase } from "../support/resetDatabase";
import { testDatabaseUrl } from "../support/testEnvironment";

/*
 * The Overpass cache as the release before wrote it ([lon, lat] JSON per vertex, one table
 * each), through the migration to partitioned tables with the compact geometry: every row
 * there, every coordinate exactly, and loadMapData reading the cache as before.
 */
const fetchedAt = "2026-10-20T08:00:00.000Z";
const ways = [
  {
    id: 4224972,
    kind: "residential",
    tags: { highway: "residential", name: "Avenue des Papalins", oneway: "yes" },
    nodes: [25177418, 4939779378, 4939779381, 4939779386, 25177397],
    geometry: [
      [7.4174924, 43.7296303],
      [7.4174638, 43.7296727],
      [7.4174191, 43.7297138],
      [7.4173286, 43.7297725],
      [7.4172044, 43.7298528],
    ],
  },
  {
    id: 100,
    kind: "rail",
    tags: { railway: "rail" },
    nodes: [1, 2, 3],
    geometry: [
      [-0.5, -12.25],
      [179.9999999, 89.9999999],
      [-180, -90],
    ],
  },
  {
    id: 101,
    kind: "footway",
    tags: { highway: "footway" },
    nodes: [4, 5],
    // JSON.stringify writes 1e-7 so: what the old saveTile stored for tiny values
    geometry: [
      [0.0000001, -0.0000001],
      [3.70001, 51.00002],
    ],
  },
] as const;
const memberships = [
  [14, 8529, 5974, 4224972],
  [14, 8529, 5974, 101],
  [14, 8530, 5974, 4224972],
  [14, 8530, 5974, 100],
] as const;
const pois = [
  ["n1327941175", "ferry_terminal", 43.7353294, 7.4306094, "Terminal Croisiere", 14, 8530, 5974],
  ["w5", "aerodrome", 43.7290001, 7.4180002, null, 14, 8529, 5974],
] as const;

const bounds = (geometry: readonly (readonly [number, number])[]) => ({
  minLat: Math.min(...geometry.map(([, lat]) => lat)),
  minLon: Math.min(...geometry.map(([lon]) => lon)),
  maxLat: Math.max(...geometry.map(([, lat]) => lat)),
  maxLon: Math.max(...geometry.map(([lon]) => lon)),
});

describe("the map cache through the migration to sources and partitions", () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 2 });
  const folders: string[] = [];

  beforeAll(async () => {
    await wipeTestDatabase(pool);
    const before = folderUpTo(tagBefore("map_regions"));
    folders.push(before);
    await runMigrations(pool, before);
    for (const way of ways) {
      const box = bounds(way.geometry);
      await pool.query(
        `INSERT INTO osm_ways (id, kind, tags, nodes, geometry, min_lat, min_lon, max_lat, max_lon, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          way.id,
          way.kind,
          JSON.stringify(way.tags),
          way.nodes,
          JSON.stringify(way.geometry),
          box.minLat,
          box.minLon,
          box.maxLat,
          box.maxLon,
          fetchedAt,
        ],
      );
    }
    for (const row of memberships) {
      await pool.query("INSERT INTO osm_tile_ways (z, x, y, way_id) VALUES ($1, $2, $3, $4)", [
        ...row,
      ]);
    }
    for (const row of pois) {
      await pool.query(
        `INSERT INTO osm_pois (id, kind, lat, lon, name, z, x, y, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [...row, fetchedAt],
      );
    }
    for (const x of [8529, 8530]) {
      await pool.query(
        `INSERT INTO osm_tiles (z, x, y, status, fetched_at, way_count, poi_count, bytes)
         VALUES (14, $1, 5974, 'ok', $2, 2, 1, 1234)`,
        [x, fetchedAt],
      );
    }
    await runMigrations(pool, migrationsFolder);
  });

  afterAll(async () => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
    await pool.end();
    await resetDatabase();
  });

  it("keeps every way in the cache's partition, its geometry exactly", async () => {
    const result = await pool.query<{
      id: string;
      source: string;
      partition: string;
      kind: string;
      tags: Record<string, string>;
      nodes: string[];
      geometry: Buffer;
      min_lat: number;
      min_lon: number;
      max_lat: number;
      max_lon: number;
      fetched_at: Date;
    }>(
      `SELECT id::text, source, tableoid::regclass::text AS partition, kind, tags, nodes::text[] AS nodes,
         geometry, min_lat, min_lon, max_lat, max_lon, fetched_at
       FROM osm_ways ORDER BY id`,
    );
    expect(result.rows).toHaveLength(ways.length);
    const expected = [...ways].sort((a, b) => a.id - b.id);
    for (const [index, row] of result.rows.entries()) {
      const way = expected[index];
      expect(row).toMatchObject({
        id: String(way?.id),
        source: "overpass",
        partition: "osm_ways_overpass",
        kind: way?.kind,
        tags: way?.tags,
        nodes: way?.nodes.map(String),
      });
      expect(decodeGeometry(row.geometry)).toEqual(way?.geometry);
      expect(row.geometry.byteLength).toBe((way?.geometry.length ?? 0) * 8);
      const box = bounds(way?.geometry ?? []);
      expect([row.min_lat, row.min_lon, row.max_lat, row.max_lon]).toEqual([
        box.minLat,
        box.minLon,
        box.maxLat,
        box.maxLon,
      ]);
      expect(row.fetched_at.toISOString()).toBe(fetchedAt);
    }
  });

  it("keeps every tile's ways, stops and fetch", async () => {
    const tileWays = await pool.query(
      "SELECT z, x, y, way_id::int AS way_id, source FROM osm_tile_ways ORDER BY x, way_id",
    );
    expect(tileWays.rows).toEqual([
      { z: 14, x: 8529, y: 5974, way_id: 101, source: "overpass" },
      { z: 14, x: 8529, y: 5974, way_id: 4224972, source: "overpass" },
      { z: 14, x: 8530, y: 5974, way_id: 100, source: "overpass" },
      { z: 14, x: 8530, y: 5974, way_id: 4224972, source: "overpass" },
    ]);
    const stops = await pool.query(
      "SELECT id, source, kind, lat, lon, name, z, x, y, fetched_at FROM osm_pois ORDER BY id",
    );
    expect(stops.rows).toEqual(
      pois.map(([id, kind, lat, lon, name, z, x, y]) => ({
        id,
        source: "overpass",
        kind,
        lat,
        lon,
        name,
        z,
        x,
        y,
        fetched_at: new Date(fetchedAt),
      })),
    );
    const tiles = await pool.query(
      "SELECT count(*)::int AS count FROM osm_tiles WHERE status = 'ok'",
    );
    expect(tiles.rows[0]?.count).toBe(2);
  });

  it("serves the cache through loadMapData as before", async () => {
    const map = await loadMapData(createDatabase(pool), ["14/8529/5974", "14/8530/5974"]);
    expect(map.ways.map((way) => way.id).sort((a, b) => a - b)).toEqual([100, 101, 4224972]);
    const papalins = map.ways.find((way) => way.id === 4224972);
    expect(papalins).toEqual({
      id: 4224972,
      kind: "residential",
      nodes: [...(ways[0]?.nodes ?? [])],
      geometry: ways[0]?.geometry,
      name: "Avenue des Papalins",
    });
    expect(map.pois.map((poi) => poi.id).sort()).toEqual(["n1327941175", "w5"]);
  });

  it("partitions the three tables by source, the cache in a partition of its own and no default one", async () => {
    const partitions = await pool.query<{ parent: string; partition: string; bound: string }>(
      `SELECT p.relname AS parent, c.relname AS partition, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname IN ('osm_ways', 'osm_tile_ways', 'osm_pois') ORDER BY p.relname`,
    );
    expect(partitions.rows).toEqual([
      { parent: "osm_pois", partition: "osm_pois_overpass", bound: "FOR VALUES IN ('overpass')" },
      {
        parent: "osm_tile_ways",
        partition: "osm_tile_ways_overpass",
        bound: "FOR VALUES IN ('overpass')",
      },
      { parent: "osm_ways", partition: "osm_ways_overpass", bound: "FOR VALUES IN ('overpass')" },
    ]);
    await expect(
      pool.query(
        `INSERT INTO osm_tile_ways (z, x, y, way_id, source) VALUES (14, 1, 1, 1, 'nowhere@20261027-00000000')`,
      ),
    ).rejects.toThrow(/no partition/);
    const foreignKeys = await pool.query(
      "SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = 'osm_tile_ways'::regclass",
    );
    expect(foreignKeys.rows).toEqual([]);
  });
});
