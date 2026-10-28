import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createGunzip } from "node:zlib";
import type { PoolClient } from "pg";
import type { Logger } from "pino";
import type { Database } from "../db/database";
import { errorCodes } from "../db/errorChain";
import { isUniqueViolation } from "../db/isUniqueViolation";
import { type ArtefactFile, fileChunks } from "./artefactFiles";
import {
  attachBuildTables,
  createBuildTables,
  indexBuildTable,
  type MapTable,
  mapTables,
  partitionName,
  quoteIdentifier,
  sweepBuildTables,
} from "./buildPartitions";
import { lockImports, unlockImports } from "./importLock";
import { loadPois } from "./loadPois";
import { loadWays, loadWayTiles } from "./loadWays";
import { MapDataError } from "./mapDataError";
import { type Artefact, openArtefact } from "./openArtefact";
import type { PoiCounts } from "./poiRows";
import type { WayCounts } from "./wayRows";

const limits = {
  lineBytes: 1 << 20,
  /** What a gzip file may unpack to: a multiple of its size (OPL unpacks to 3×) above a floor. */
  unpackFactor: 20,
  unpackFloorBytes: 64 << 20,
  /** A file with more unreadable lines than this share is no map data file. */
  malformedShare: 0.01,
  /** The swap waits this long for the tables at a time, as often as this. */
  lockWaitMs: 10_000,
  lockAttempts: 30,
};

/** What `trail map import` and the worker's refresh (task 2) are told. */
export interface ImportRegionResult {
  region: string;
  buildId: string;
  digest: string;
  source: string;
  /** False when the build was ready already, so nothing changed. */
  imported: boolean;
  ways: number;
  memberships: number;
  pois: number;
  /** Lines the import left out: unreadable (malformed) or no way or stop Trail keeps. */
  dropped: { ways: number; unclassifiedWays: number; pois: number; unclassifiedPois: number };
  /** The sources of the builds it replaced. */
  replaced: string[];
  seconds: number;
}

/** Where the import has got to: the CLI's progress, and how a test takes hold of the swap. */
export type ImportStep = "verified" | "loaded" | "indexed" | "locked" | "committed" | "swept";

export interface ImportRegionOptions {
  db: Database;
  logger: Logger;
  /** A build's directory: manifest.json, ways.opl.gz, pois.geojsonseq.gz, region.poly. */
  dir: string;
  /**
   * The build's OCI manifest digest when it was pulled from the registry;
   * null for a directory at hand, whose digest is then the SHA-256 of its
   * oci-manifest.json (a pulled build's) or of its manifest.json.
   */
  digest: string | null;
  signal?: AbortSignal;
  onStep?: (step: ImportStep) => void | Promise<void>;
}

/** Another import holds the lock: this one did not start. */
export class MapImportBusyError extends Error {
  constructor() {
    super("another map import is running; try again when it has finished");
    this.name = "MapImportBusyError";
  }
}

/**
 * Runs `read` over the unpacked text of a gzip file, hashing the packed bytes
 * on the way: a file that no longer matches its SHA-256 at the end changed
 * while it was read, and the import is undone.
 */
async function readUnpacked<T>(
  file: ArtefactFile,
  sha256: string,
  read: (chunks: AsyncIterable<Uint8Array>) => Promise<T>,
): Promise<T> {
  const hash = createHash("sha256");
  const results: T[] = [];
  try {
    await pipeline(
      fileChunks(file),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createGunzip(),
      async (chunks: AsyncIterable<Uint8Array>) => {
        results.push(await read(chunks));
      },
    );
  } catch (error) {
    if (errorCodes(error).some((code) => code.startsWith("Z_"))) {
      throw new MapDataError(`${file.name} is no gzip file, or a damaged one`);
    }
    throw error;
  }
  if (hash.digest("hex") !== sha256)
    throw new MapDataError(`${file.name} changed while it was read`);
  const [result] = results;
  if (result === undefined) throw new MapDataError(`${file.name} was not read`);
  return result;
}

function checkCounts(artefact: Artefact, ways: WayCounts, pois: PoiCounts): void {
  const { counts } = artefact.manifest;
  if (ways.lines !== counts.ways) {
    throw new MapDataError(
      `ways.opl.gz has ${ways.lines} lines, manifest.json counts ${counts.ways} ways`,
    );
  }
  if (ways.malformed === 0 && ways.nodeRefs !== counts.wayNodeRefs) {
    throw new MapDataError(
      `ways.opl.gz has ${ways.nodeRefs} node references, manifest.json counts ${counts.wayNodeRefs}`,
    );
  }
  if (ways.malformed > Math.max(10, ways.lines * limits.malformedShare)) {
    throw new MapDataError(
      `${ways.malformed} of the ${ways.lines} lines of ways.opl.gz are no ways Trail can read`,
    );
  }
  if (pois.features !== counts.poiFeatures) {
    throw new MapDataError(
      `pois.geojsonseq.gz has ${pois.features} features, manifest.json counts ${counts.poiFeatures}`,
    );
  }
}

/**
 * The build's three tables, in the open transaction: created, loaded with one
 * `COPY … FREEZE` each (the ways file read twice, once for the ways and once
 * for their tiles, as a connection runs one COPY at a time), checked against
 * the manifest's counts, keyed and analysed.
 */
async function loadBuildTables(
  client: PoolClient,
  artefact: Artefact,
  signal: AbortSignal | undefined,
): Promise<{ ways: WayCounts; pois: PoiCounts }> {
  const { key, source, manifest } = artefact;
  await createBuildTables(client, key, source);
  const input = (table: MapTable, file: ArtefactFile, chunks: AsyncIterable<Uint8Array>) => ({
    chunks,
    limits: {
      maxLineBytes: limits.lineBytes,
      maxBytes: Math.max(limits.unpackFloorBytes, file.bytes * limits.unpackFactor),
    },
    table: partitionName(table, key),
    source,
    fetchedAt: manifest.extractTimestamp,
    signal,
  });
  const { ways: waysFile, pois: poisFile } = artefact;
  const ways = await readUnpacked(waysFile, manifest.files.ways.sha256, (chunks) =>
    loadWays(client, input("osm_ways", waysFile, chunks)),
  );
  const tiles = await readUnpacked(waysFile, manifest.files.ways.sha256, (chunks) =>
    loadWayTiles(client, input("osm_tile_ways", waysFile, chunks)),
  );
  if (tiles.ways !== ways.ways || tiles.memberships !== ways.memberships) {
    throw new MapDataError("ways.opl.gz read differently the second time");
  }
  const pois = await readUnpacked(poisFile, manifest.files.pois.sha256, (chunks) =>
    loadPois(client, input("osm_pois", poisFile, chunks)),
  );
  checkCounts(artefact, ways, pois);
  return { ways, pois };
}

/** The keys of the build's tables, a duplicate in the files named as such. */
async function indexBuildTables(client: PoolClient, artefact: Artefact): Promise<void> {
  for (const table of mapTables) {
    try {
      await indexBuildTable(client, table, artefact.key);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new MapDataError(
        table === "osm_pois"
          ? "pois.geojsonseq.gz holds a stop twice"
          : "ways.opl.gz holds a way twice",
      );
    }
  }
  await client.query(
    `ANALYZE ${mapTables.map((table) => quoteIdentifier(partitionName(table, artefact.key))).join(", ")}`,
  );
}

/**
 * Takes the three parents for the swap: a reader's partitions are fixed when
 * it is planned and its rows when it runs, so the attach and the flip must
 * not fall between the two. It waits `lockWaitMs` at a time, so that readers
 * queued behind it are never held up for long, and tries again.
 */
async function takeMapTables(client: PoolClient, signal: AbortSignal | undefined): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    await client.query("SAVEPOINT take_map_tables");
    try {
      await client.query(`SET LOCAL lock_timeout = ${limits.lockWaitMs}`);
      await client.query(
        `LOCK TABLE ${mapTables.map(quoteIdentifier).join(", ")} IN ACCESS EXCLUSIVE MODE`,
      );
      await client.query("RELEASE SAVEPOINT take_map_tables");
      return;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT take_map_tables");
      if (!errorCodes(error).includes("55P03") || attempt >= limits.lockAttempts) throw error;
      await delay(1000, undefined, signal === undefined ? {} : { signal });
    }
  }
}

/** Records the build as `importing` (a failed or interrupted one again); null when it is ready already. */
async function recordImporting(client: PoolClient, artefact: Artefact): Promise<string | null> {
  const { key, source } = artefact;
  try {
    return await upsertImporting(client, artefact);
  } catch (error) {
    if (!isUniqueViolation(error, "osm_regions_source_key")) throw error;
    // Two digests of one region and day that share their first 8 hex digits: one in 4 billion.
    throw new MapDataError(
      `another build of ${key.region} from ${key.buildId} has a digest that begins like this one's, so both would be ${source}: this one can be imported once that build is replaced`,
    );
  }
}

async function upsertImporting(client: PoolClient, artefact: Artefact): Promise<string | null> {
  const { key, source, manifest, outline } = artefact;
  const row = await client.query<{ id: string }>(
    `INSERT INTO osm_regions (name, build_id, digest, source, status, extract_timestamp, built_at,
       polygon, min_lat, min_lon, max_lat, max_lon)
     VALUES ($1, $2, $3, $4, 'importing', $5, $6, $7::jsonb, $8, $9, $10, $11)
     ON CONFLICT (name, digest) DO UPDATE SET status = 'importing', error = NULL,
       build_id = excluded.build_id, source = excluded.source,
       extract_timestamp = excluded.extract_timestamp, built_at = excluded.built_at,
       polygon = excluded.polygon, min_lat = excluded.min_lat, min_lon = excluded.min_lon,
       max_lat = excluded.max_lat, max_lon = excluded.max_lon, updated_at = now()
     WHERE osm_regions.status <> 'ready'
     RETURNING id`,
    [
      key.region,
      key.buildId,
      key.digest,
      source,
      manifest.extractTimestamp.toISOString(),
      manifest.builtAt?.toISOString() ?? null,
      JSON.stringify(outline.polygon),
      outline.minLat,
      outline.minLon,
      outline.maxLat,
      outline.maxLon,
    ],
  );
  return row.rows[0]?.id ?? null;
}

/**
 * Imports a region's build from its directory (docs/design/self-hosted-maps.md
 * §2.2, §2.6). The files are checked against manifest.json first. Then, under
 * a lock that admits one import at a time, the build is recorded as
 * `importing` and, in one transaction, its ways, their tiles and its stops
 * are streamed into tables of its own and keyed, and it is swapped in: the
 * three parents taken for a moment, the tables attached as the partitions of
 * the build's source, the build `ready` and the region's previous build's row
 * gone, all in one commit, so a reader sees the old build or the new one,
 * whole. The old build's partitions are detached concurrently and dropped
 * after. A failure undoes the transaction and leaves the build `failed` with
 * its reason, the previous one serving; a build that is ready already is left
 * as it is.
 */
export async function importRegion(options: ImportRegionOptions): Promise<ImportRegionResult> {
  const started = performance.now();
  const { db, logger, signal, onStep } = options;
  const artefact = await openArtefact(options.dir, options.digest);
  const { key, source } = artefact;
  const log = logger.child({ region: key.region, build: key.buildId });
  const summary = (
    counts: Pick<
      ImportRegionResult,
      "imported" | "ways" | "memberships" | "pois" | "dropped" | "replaced"
    >,
  ): ImportRegionResult => ({
    region: key.region,
    buildId: key.buildId,
    digest: key.digest,
    source,
    ...counts,
    seconds: (performance.now() - started) / 1000,
  });
  try {
    await onStep?.("verified");
    const client = await db.$client.connect();
    try {
      // The import's own session: no statement limit (an index of Europe takes minutes); discarded after.
      await client.query("SET statement_timeout = 0");
      if (!(await lockImports(client))) throw new MapImportBusyError();
      try {
        await sweepBuildTables(client, log);
        const buildRow = await recordImporting(client, artefact);
        if (buildRow === null) {
          const ready = await client.query<{
            way_count: number;
            membership_count: number;
            poi_count: number;
          }>(
            "SELECT way_count, membership_count, poi_count FROM osm_regions WHERE name = $1 AND digest = $2",
            [key.region, key.digest],
          );
          log.info({ digest: key.digest }, "map region build is imported already");
          return summary({
            imported: false,
            ways: ready.rows[0]?.way_count ?? 0,
            memberships: ready.rows[0]?.membership_count ?? 0,
            pois: ready.rows[0]?.poi_count ?? 0,
            dropped: { ways: 0, unclassifiedWays: 0, pois: 0, unclassifiedPois: 0 },
            replaced: [],
          });
        }
        let counts: { ways: WayCounts; pois: PoiCounts };
        let replaced: string[];
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL maintenance_work_mem = '512MB'");
          counts = await loadBuildTables(client, artefact, signal);
          await onStep?.("loaded");
          await indexBuildTables(client, artefact);
          await onStep?.("indexed");
          signal?.throwIfAborted();
          await takeMapTables(client, signal);
          await onStep?.("locked");
          await attachBuildTables(client, key, source);
          // The region's previous build goes, and its failed attempts with it (their reasons are logged).
          const old = await client.query<{ source: string; status: string }>(
            "DELETE FROM osm_regions WHERE name = $1 AND id <> $2 RETURNING source, status",
            [key.region, buildRow],
          );
          replaced = old.rows.filter((row) => row.status === "ready").map((row) => row.source);
          await client.query(
            `UPDATE osm_regions SET status = 'ready', error = NULL, way_count = $2,
               membership_count = $3, poi_count = $4, imported_at = now(), updated_at = now()
             WHERE id = $1`,
            [buildRow, counts.ways.ways, counts.ways.memberships, counts.pois.pois],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          const reason =
            error instanceof Error && error.name === "AbortError"
              ? "interrupted"
              : error instanceof Error
                ? error.message
                : String(error);
          await client
            .query(
              "UPDATE osm_regions SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = 'importing'",
              [buildRow, reason.slice(0, 500)],
            )
            .catch((recordError: unknown) => {
              log.error({ err: recordError }, "map region import failure not recorded");
            });
          log.warn({ err: error }, "map region import failed");
          throw error;
        }
        await onStep?.("committed");
        try {
          await sweepBuildTables(client, log);
          // The parents' own statistics: autovacuum leaves partitioned tables alone.
          await client.query(
            `ANALYZE ${mapTables.map((table) => `ONLY ${quoteIdentifier(table)}`).join(", ")}`,
          );
        } catch (error) {
          // The build is in and serves; the next import or start sweeps what is left.
          log.warn({ err: error }, "map region import could not remove the old build yet");
        }
        await onStep?.("swept");
        const result = summary({
          imported: true,
          ways: counts.ways.ways,
          memberships: counts.ways.memberships,
          pois: counts.pois.pois,
          dropped: {
            ways: counts.ways.malformed,
            unclassifiedWays: counts.ways.unclassified,
            pois: counts.pois.malformed,
            unclassifiedPois: counts.pois.unclassified,
          },
          replaced,
        });
        log.info(
          {
            ways: result.ways,
            pois: result.pois,
            memberships: result.memberships,
            seconds: result.seconds,
          },
          "map region imported",
        );
        return result;
      } finally {
        await unlockImports(client);
      }
    } finally {
      // The session's settings must not reach the pool's other users.
      client.release(true);
    }
  } finally {
    await artefact.close();
  }
}
