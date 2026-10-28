import type { Pool } from "pg";
import type { Logger } from "pino";
import type { Config } from "../config/config";
import { MapDataRefresher } from "./mapDataRefresher";

/**
 * The refresher of this process, for the worker's schedule and `trail map
 * refresh`: the configured registry and volume, and the map tables
 * (docs/design/self-hosted-maps.md §8.5). The loader of task 1 is what
 * imports a pulled build, through its `listRegionRows` and `importRegion`
 * as the `RegionTables` port; this version passes none, so builds are
 * pulled onto the volume, shown by `trail map status`, and imported once
 * the loader is passed in here.
 */
export function createMapDataRefresher(input: {
  config: Config;
  pool: Pool;
  logger: Logger;
}): MapDataRefresher {
  return new MapDataRefresher({
    settings: input.config.mapData,
    pool: input.pool,
    logger: input.logger.child({ component: "mapdata" }),
    tables: null,
  });
}
