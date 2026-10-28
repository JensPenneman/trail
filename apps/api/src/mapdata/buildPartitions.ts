import type { PoolClient } from "pg";
import type { Logger } from "pino";

/** The source of the rows Overpass sent: the cache of tileStore.ts, partition `<table>_overpass`. */
export const overpassSource = "overpass";

/**
 * The partitioned map tables, in the order every reader and writer takes
 * them (loadMapData, saveTile); the swap locks them in the same order, so
 * neither waits for the other while holding what the other wants.
 */
export const mapTables = ["osm_tile_ways", "osm_ways", "osm_pois"] as const;
export type MapTable = (typeof mapTables)[number];

/** What names a region's build: its region, its day and its digest. */
export interface BuildKey {
  region: string;
  buildId: string;
  /** `sha256:<64 hex>` */
  digest: string;
}

const digestPrefix = "sha256:";
const digest8 = (digest: string): string =>
  digest.slice(digestPrefix.length, digestPrefix.length + 8);

/** The `source` of a build's rows: `<region>@<yyyymmdd>-<first 8 hex of the digest>`. */
export const buildSource = (key: BuildKey): string =>
  `${key.region}@${key.buildId}-${digest8(key.digest)}`;

/**
 * The partition of `table` that holds a build's rows,
 * `osm_ways_<region>_<yyyymmdd>_<digest8>` with the region's dashes as
 * underscores: at most 63 characters for a region of 31, and the `osm_`
 * prefix the backup leaves out.
 */
export const partitionName = (table: MapTable, key: BuildKey): string =>
  `${table}_${key.region.replaceAll("-", "_")}_${key.buildId}_${digest8(key.digest)}`;

/** Every name `partitionName` gives: what the sweep may remove. */
const partitionPattern = /^osm_(tile_ways|ways|pois)_[a-z0-9_]+_[0-9]{8}_[0-9a-f]{8}$/;

export const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * The keys and indexes of the parents (the map regions' migration), which a build's
 * partitions get before they are attached, so that ATTACH finds them and
 * builds nothing while it holds the tables. A test compares them with the
 * parents' own.
 */
export const partitionIndexes: Readonly<
  Record<MapTable, readonly { primary: boolean; columns: readonly string[] }[]>
> = {
  osm_tile_ways: [{ primary: true, columns: ["z", "x", "y", "way_id", "source"] }],
  osm_ways: [{ primary: true, columns: ["id", "source"] }],
  osm_pois: [
    { primary: true, columns: ["id", "source"] },
    { primary: false, columns: ["z", "x", "y"] },
  ],
};

/**
 * A build's three tables, standalone and without indexes for the load: the
 * parents' columns, defaults and checks, and a check on the source, so that
 * attaching needs no scan to prove the rows belong.
 */
export async function createBuildTables(
  client: PoolClient,
  key: BuildKey,
  source: string,
): Promise<void> {
  for (const table of mapTables) {
    await client.query(
      `CREATE TABLE ${quoteIdentifier(partitionName(table, key))} (
         LIKE ${quoteIdentifier(table)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
         CONSTRAINT build_source_check CHECK (source = ${quoteLiteral(source)})
       )`,
    );
  }
}

/** The keys and indexes of `partitionIndexes` on a build's loaded tables (Postgres names them). */
export async function indexBuildTable(
  client: PoolClient,
  table: MapTable,
  key: BuildKey,
): Promise<void> {
  const name = quoteIdentifier(partitionName(table, key));
  for (const index of partitionIndexes[table]) {
    const columns = index.columns.map(quoteIdentifier).join(", ");
    await client.query(
      index.primary
        ? `ALTER TABLE ${name} ADD PRIMARY KEY (${columns})`
        : `CREATE INDEX ON ${name} (${columns})`,
    );
  }
}

/** Makes a build's tables partitions of the parents; the caller holds the parents. */
export async function attachBuildTables(
  client: PoolClient,
  key: BuildKey,
  source: string,
): Promise<void> {
  for (const table of mapTables) {
    await client.query(
      `ALTER TABLE ${quoteIdentifier(table)} ATTACH PARTITION ${quoteIdentifier(partitionName(table, key))}
       FOR VALUES IN (${quoteLiteral(source)})`,
    );
  }
}

interface MapRelation extends Record<string, unknown> {
  name: string;
  parent: string | null;
  bound: string | null;
  pending: boolean | null;
}

/**
 * Clears up after imports that did not finish, under the import lock
 * (importRegion.ts), so no import is running: a build still `importing` was
 * cut off and becomes `failed`; a partition left half detached is finished
 * and dropped, whatever references it (a detach is never a serving build);
 * the partitions and tables of builds that are not `ready` (the build a swap
 * replaced, what a crash left between the swap's commit and the drop) are
 * detached concurrently, so readers never wait, and dropped. Outside a
 * transaction, as DETACH … CONCURRENTLY must be. Returns the tables dropped.
 */
export async function sweepBuildTables(client: PoolClient, logger: Logger): Promise<string[]> {
  const interrupted = await client.query(
    "UPDATE osm_regions SET status = 'failed', error = 'interrupted', updated_at = now() WHERE status = 'importing'",
  );
  if ((interrupted.rowCount ?? 0) > 0) {
    logger.warn({ builds: interrupted.rowCount }, "map region imports found interrupted");
  }
  const ready = await client.query<{
    name: string;
    build_id: string;
    digest: string;
    source: string;
  }>("SELECT name, build_id, digest, source FROM osm_regions WHERE status = 'ready'");
  const sources = new Set([overpassSource, ...ready.rows.map((row) => row.source)]);
  const names = new Set(
    ready.rows.flatMap((row) =>
      mapTables.map((table) =>
        partitionName(table, { region: row.name, buildId: row.build_id, digest: row.digest }),
      ),
    ),
  );
  const relations = await client.query<MapRelation>(
    `SELECT c.relname AS name, p.relname AS parent,
       pg_get_expr(c.relpartbound, c.oid) AS bound, i.inhdetachpending AS pending
     FROM pg_class c
     JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = current_schema()
     LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
     LEFT JOIN pg_class p ON p.oid = i.inhparent
     WHERE c.relkind = 'r' AND c.relname LIKE 'osm\\_%'`,
  );
  const dropped: string[] = [];
  for (const relation of relations.rows) {
    if (!partitionPattern.test(relation.name)) continue;
    const parent = relation.parent;
    if (parent !== null) {
      if (!(mapTables as readonly string[]).includes(parent)) continue;
      if (relation.pending !== true) {
        const source = /^FOR VALUES IN \('([^']*)'\)$/.exec(relation.bound ?? "")?.[1];
        if (source === undefined || sources.has(source)) continue;
      }
      await client.query(
        `ALTER TABLE ${quoteIdentifier(parent)} DETACH PARTITION ${quoteIdentifier(relation.name)} ${relation.pending === true ? "FINALIZE" : "CONCURRENTLY"}`,
      );
    } else if (names.has(relation.name)) {
      continue;
    }
    await client.query(`DROP TABLE ${quoteIdentifier(relation.name)}`);
    dropped.push(relation.name);
  }
  if (dropped.length > 0) logger.info({ tables: dropped.length }, "map build tables removed");
  return dropped;
}
