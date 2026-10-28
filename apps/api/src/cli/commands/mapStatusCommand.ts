import { sql } from "drizzle-orm";
import { mapTables, partitionName } from "../../mapdata/buildPartitions";
import { createMapDataRefresher } from "../../mapdata/createMapDataRefresher";
import {
  type LocalBuild,
  listLocalBuilds,
  listLocalRegions,
  volumeBytes,
} from "../../mapdata/localBuilds";
import type { MapDataRefresher } from "../../mapdata/mapDataRefresher";
import { listRegionRows, type RegionRow } from "../../mapdata/regionRows";
import type { CliContext } from "../cliContext";

const shortTime = (value: string | Date): string =>
  (typeof value === "string" ? value : value.toISOString()).slice(0, 16).replace("T", " ");

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** The disk of each build's partitions, by source; nothing for a build whose tables are not there. */
async function buildSizes(
  ctx: CliContext,
  rows: readonly RegionRow[],
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (const row of rows) {
    const names = mapTables.map((table) =>
      partitionName(table, { region: row.name, buildId: row.buildId, digest: row.digest }),
    );
    // The names are letters, digits and underscores (partitionName): a plain array literal.
    const result = await ctx.db.execute<{ bytes: string | null }>(sql`
      SELECT sum(pg_total_relation_size(to_regclass(name)))::text AS bytes
      FROM unnest(${`{${names.join(",")}}`}::text[]) AS name
    `);
    const bytes = result.rows[0]?.bytes;
    if (bytes !== null && bytes !== undefined) sizes.set(row.source, Number(bytes));
  }
  return sizes;
}

/** The map tables: every region's builds (ready, importing, failed) and the Overpass cache. */
async function printMapTables(ctx: CliContext): Promise<void> {
  const rows = await listRegionRows(ctx.db);
  if (rows.length === 0) {
    console.log("Map tables: no region builds yet (trail map refresh, or trail map import <dir>)");
  } else {
    console.log("Map tables:");
    const sizes = await buildSizes(ctx, rows);
    console.table(
      rows.map((row) => ({
        region: row.name,
        status: row.status,
        build: row.buildId,
        extract: shortTime(row.extractTimestamp),
        imported: row.importedAt === null ? "" : shortTime(row.importedAt),
        ways: row.wayCount,
        stops: row.poiCount,
        size: sizes.has(row.source) ? megabytes(sizes.get(row.source) ?? 0) : "",
        digest: `${row.digest.slice(0, 19)}…`,
        error: row.error ?? "",
      })),
    );
  }
  const cache = await ctx.db.execute<{ tiles: number; ways: number; bytes: string }>(sql`
    SELECT (SELECT count(*)::int FROM osm_tiles WHERE status = 'ok') AS tiles,
      (SELECT count(*)::int FROM osm_ways WHERE source = 'overpass') AS ways,
      (pg_total_relation_size('osm_ways_overpass') + pg_total_relation_size('osm_tile_ways_overpass')
        + pg_total_relation_size('osm_pois_overpass'))::text AS bytes
  `);
  const overpass = cache.rows[0];
  if (overpass !== undefined) {
    console.log(
      `Overpass cache: ${overpass.tiles} tiles, ${overpass.ways} ways, ${megabytes(Number(overpass.bytes))}`,
    );
  }
}

function buildLine(build: LocalBuild, imported: boolean): string {
  const extract =
    build.extractTimestamp === null
      ? ""
      : `, OSM data up to ${shortTime(build.extractTimestamp)} UTC`;
  const shared =
    build.sharedBytes > 0
      ? ` (${megabytes(build.sharedBytes)} of it shared with another build)`
      : "";
  return `  ${build.name}: ${megabytes(build.bytes)}${shared}, pulled ${shortTime(build.pulledAt)} UTC${extract}${imported ? ", imported" : ""}\n    ${build.digest}`;
}

/**
 * `trail map status` — the map data on the volume: every configured region
 * (and the world overview) with its builds, their digests (to compare with
 * the workflow's attestation), when they were pulled and whether the map
 * tables hold them, and the regions on the volume no longer configured;
 * then the map tables: every region's builds with their status, counts,
 * size and last error, and the Overpass cache. Asks the registry nothing.
 */
export async function mapStatusCommand(
  ctx: CliContext,
  refresher: Pick<MapDataRefresher, "regions" | "tableRows" | "importing"> = createMapDataRefresher(
    {
      config: ctx.config,
      pool: ctx.db.$client,
      logger: ctx.logger,
    },
  ),
): Promise<void> {
  const settings = ctx.config.mapData;
  const regions = refresher.regions();
  const registry = `${settings.registry.host}/${settings.registry.repository}`;
  if (regions.length === 0) {
    console.log(`No map regions configured (MAP_DATA_REGIONS is empty); registry ${registry}`);
  } else {
    console.log(
      `Map data: ${regions.join(", ")} from ${registry}, refreshed every ${settings.refreshDays} days, in ${settings.dir}`,
    );
  }
  const rows = await refresher.tableRows();
  if (!refresher.importing)
    console.log("The map tables are not part of this version: builds wait on the volume.");
  const onVolume = await listLocalRegions(settings.dir);
  for (const region of [...regions, ...onVolume.filter((name) => !regions.includes(name))]) {
    const builds = await listLocalBuilds(settings.dir, region);
    const configured = regions.includes(region) ? "" : " (not in MAP_DATA_REGIONS)";
    console.log(
      `${region}${configured}: ${builds.length === 0 ? "no build on the volume yet" : `${builds.length} on the volume`}`,
    );
    for (const build of builds) {
      const imported = (rows ?? []).some(
        (row) => row.name === region && row.status === "ready" && row.digest === build.digest,
      );
      console.log(buildLine(build, imported));
    }
  }
  if (onVolume.length > 0) {
    console.log(`On the volume: ${megabytes(await volumeBytes(settings.dir))} in all`);
  }
  await printMapTables(ctx);
}
