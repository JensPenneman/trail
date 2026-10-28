import { createMapDataRefresher } from "../../mapdata/createMapDataRefresher";
import {
  type LocalBuild,
  listLocalBuilds,
  listLocalRegions,
  volumeBytes,
} from "../../mapdata/localBuilds";
import type { MapDataRefresher } from "../../mapdata/mapDataRefresher";
import type { CliContext } from "../cliContext";

const shortTime = (value: string | Date): string =>
  (typeof value === "string" ? value : value.toISOString()).slice(0, 16).replace("T", " ");

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

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
 * tables hold them, and the regions on the volume no longer configured.
 * Asks the registry nothing.
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
}
