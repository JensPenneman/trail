import type { Pool } from "pg";
import type { Logger } from "pino";
import type { Config } from "../config/config";
import { createDatabase } from "../db/database";
import { loaderTables } from "./loaderTables";
import { MapDataRefresher } from "./mapDataRefresher";

/**
 * The refresher of this process, for the worker's schedule and `trail map
 * refresh`: the configured registry and volume, and the map tables
 * (docs/design/self-hosted-maps.md §8.5), whose loader imports a pulled
 * build through `listRegionRows` and `importRegion` (loaderTables.ts).
 */
export function createMapDataRefresher(input: {
  config: Config;
  pool: Pool;
  logger: Logger;
}): MapDataRefresher {
  const logger = input.logger.child({ component: "mapdata" });
  return new MapDataRefresher({
    settings: input.config.mapData,
    pool: input.pool,
    logger,
    tables: loaderTables(createDatabase(input.pool), logger),
  });
}
