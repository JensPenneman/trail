import type { Logger } from "pino";
import type { Database } from "../db/database";
import { importRegion } from "./importRegion";
import { listRegionRows } from "./regionRows";
import type { RegionTables } from "./regionTables";

/**
 * The map tables as the refresh sees them (`RegionTables`): the builds the
 * loader holds, and its import of a pulled build's directory, under the
 * build's OCI digest (a first import, or the swap of
 * docs/design/self-hosted-maps.md §2.6).
 */
export const loaderTables = (db: Database, logger: Logger): RegionTables => ({
  list: () => listRegionRows(db),
  import: (input) => importRegion({ db, logger, ...input }),
});
