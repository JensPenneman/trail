import { createMapDataRefresher } from "../../mapdata/createMapDataRefresher";
import type { MapDataRefresher, RefreshOutcome } from "../../mapdata/mapDataRefresher";
import { worldRegion } from "../../mapdata/regionName";
import type { CliContext } from "../cliContext";
import { UsageError } from "../usageError";

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** What a refresh did, in lines for people: the build, the tables, what failed. */
function describeRefresh(outcome: RefreshOutcome): string[] {
  const { region, build, registry } = outcome;
  if (outcome.busy) {
    return [
      `${region}: another process is refreshing it (the worker, or another trail map refresh)`,
    ];
  }
  const lines: string[] = [];
  if (outcome.pulled !== null && build !== null) {
    lines.push(
      `${region}: pulled build ${build.name}, ${megabytes(outcome.pulled.bytes)} in ${outcome.pulled.seconds} s (${build.digest})`,
    );
  } else if (outcome.keptNewer && build !== null && registry !== null) {
    lines.push(
      `${region}: kept build ${build.name}, newer than the registry's ${registry.buildId}`,
    );
  } else if (build !== null && registry !== null) {
    lines.push(`${region}: build ${build.name} is the registry's (${build.digest})`);
  } else if (build !== null) {
    lines.push(`${region}: build ${build.name} on the volume (${build.digest})`);
  } else {
    lines.push(`${region}: no build`);
  }
  switch (outcome.tables) {
    case "imported":
      lines.push(
        `  imported: ${outcome.imported?.ways ?? 0} ways and ${outcome.imported?.pois ?? 0} stops`,
      );
      break;
    case "current":
      lines.push("  the map tables hold it");
      break;
    case "unavailable":
      lines.push("  not imported: this version of Trail has no map data loader yet");
      break;
    case "none":
      lines.push("  the world overview, kept for the basemap (never imported)");
      break;
    case null:
      break;
  }
  for (const failure of outcome.failures) {
    lines.push(`  failed (${failure.stage}, ${failure.reason}): ${failure.message}`);
  }
  if (outcome.removed.length > 0) {
    lines.push(`  removed older builds: ${outcome.removed.map((old) => old.name).join(", ")}`);
  }
  return lines;
}

/**
 * `trail map refresh [<region>]` — what the worker does every
 * MAP_DATA_REFRESH_DAYS, now: asks the registry for each region's newest
 * build (or one region's), pulls it when the volume lacks it and imports it
 * when the tables do. Ctrl-C stops it and deletes the download under way.
 */
export async function mapRefreshCommand(
  ctx: CliContext,
  region: string | undefined,
  refresher: Pick<MapDataRefresher, "regions" | "refresh"> = createMapDataRefresher({
    config: ctx.config,
    pool: ctx.db.$client,
    logger: ctx.logger,
  }),
): Promise<void> {
  const regions = refresher.regions();
  if (regions.length === 0) {
    throw new Error("MAP_DATA_REGIONS is empty: this server keeps no map regions");
  }
  if (region !== undefined && !regions.includes(region)) {
    throw new UsageError(
      `${region} is not one of this server's regions: ${regions.filter((name) => name !== worldRegion).join(", ")} (MAP_DATA_REGIONS), and ${worldRegion}`,
    );
  }
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt);
  let unfinished = 0;
  const targets = region === undefined ? regions : [region];
  try {
    for (const name of targets) {
      const outcome = await refresher.refresh(name, abort.signal);
      for (const line of describeRefresh(outcome)) console.log(line);
      if (outcome.busy || outcome.failures.length > 0) unfinished += 1;
    }
  } finally {
    process.off("SIGINT", interrupt);
  }
  if (unfinished > 0) {
    throw new Error(`${unfinished} of ${targets.length} regions were not refreshed`);
  }
}
