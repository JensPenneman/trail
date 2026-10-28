/**
 * A build of a region as the map tables hold it (`osm_regions`,
 * docs/design/self-hosted-maps.md §2.4): the loader's `listRegionRows`
 * gives one per build, the ready one first.
 */
export interface RegionRow {
  name: string;
  /** `yyyymmdd`, the extract's day. */
  buildId: string;
  /** The OCI manifest digest of a pulled build; for a build imported by hand, the SHA-256 of its manifest.json. */
  digest: string;
  status: "importing" | "ready" | "failed";
  extractTimestamp: string;
}

/** What an import did: `imported` is false for a build the tables held already. */
export interface RegionImport {
  imported: boolean;
  buildId: string;
  ways: number;
  pois: number;
}

/**
 * The map tables as the refresh needs them (docs/design/self-hosted-maps.md
 * §8.5): the builds each region's tables hold, and the loader, which
 * imports a pulled build's directory (a first import, or the swap of §2.6).
 * The loader's `listRegionRows` and `importRegion` implement it; a version
 * of Trail without them pulls builds onto the volume, where they wait.
 */
export interface RegionTables {
  list(): Promise<readonly RegionRow[]>;
  import(input: { dir: string; digest: string; signal: AbortSignal }): Promise<RegionImport>;
}
