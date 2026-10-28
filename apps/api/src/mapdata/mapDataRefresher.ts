import type { Pool } from "pg";
import type { Logger } from "pino";
import type { MapDataSettings } from "../config/config";
import { type ArtefactLayout, readArtefactLayout } from "./artefactLayout";
import {
  type LocalBuild,
  listLocalBuilds,
  pruneLocalBuilds,
  removeStaleDownloads,
} from "./localBuilds";
import { type PullOptions, pullBuild } from "./pullBuild";
import { withRegionLock } from "./regionLock";
import { worldRegion } from "./regionName";
import type { RegionImport, RegionRow, RegionTables } from "./regionTables";
import { RegistryClient, type ResolvedManifest } from "./registry";
import { RegistryError } from "./registryError";

/** Without the tables to ask, the volume keeps its two newest builds (docs/design/self-hosted-maps.md §2.7). */
const keptBuilds = 2;
const dayMs = 86_400_000;

/** A step of a refresh that failed, and why, in words without a URL or a token. */
export interface RefreshFailure {
  stage: "registry" | "download" | "import" | "volume";
  /** A `RegistryFailure`, or `import` for the loader's errors. */
  reason: string;
  message: string;
}

/** What a refresh of one region did (docs/design/self-hosted-maps.md §2.6). */
export interface RefreshOutcome {
  region: string;
  /** The build the registry's tag points at, when it answered. */
  registry: { buildId: string; digest: string } | null;
  /** The build on the volume that serves, or is to: the registry's, or the newest kept one. */
  build: LocalBuild | null;
  /** Downloaded in this refresh. */
  pulled: { bytes: number; seconds: number } | null;
  /** The registry's build is older than the newest on the volume, which is kept. */
  keptNewer: boolean;
  /**
   * The tables: `imported` now, `current` (they hold the build already),
   * `unavailable` (no loader in this version), `none` (the world overview,
   * which is never imported), or null when there is no build to import.
   */
  tables: "imported" | "current" | "unavailable" | "none" | null;
  imported: RegionImport | null;
  /** Older builds deleted from the volume. */
  removed: LocalBuild[];
  /** Another process holds the region's lock: nothing was done. */
  busy: boolean;
  failures: RefreshFailure[];
}

const failureOf = (stage: RefreshFailure["stage"], error: unknown): RefreshFailure => ({
  stage,
  reason: error instanceof RegistryError ? error.reason : stage === "import" ? "import" : "error",
  message: error instanceof Error ? error.message : String(error),
});

/**
 * Keeps the configured regions' map data current (docs/design/self-hosted-maps.md
 * §2.6, §4.3): asks the registry which build each region's tag points at,
 * pulls it when the volume does not hold it yet and it is not older than the
 * newest there (the digest identifies a build: a rebuild of the same extract
 * is pulled as well), hands it to the loader when the tables hold another,
 * and keeps on the volume the build to serve and the one served before it,
 * until the next refresh. A failed step keeps whatever serves now; the log
 * says why. Used by the worker's schedule and by `trail map refresh`.
 */
export class MapDataRefresher {
  readonly settings: MapDataSettings;
  readonly client: RegistryClient;
  readonly #pool: Pool;
  readonly #logger: Logger;
  readonly #tables: RegionTables | null;
  readonly #pull: Pick<PullOptions, "download" | "freeBytes">;
  readonly #now: () => Date;

  constructor(input: {
    settings: MapDataSettings;
    pool: Pool;
    logger: Logger;
    tables: RegionTables | null;
    /** For tests: a client for the fake registry, the download's patience, the free space and the clock. */
    client?: RegistryClient;
    pull?: Pick<PullOptions, "download" | "freeBytes">;
    now?: () => Date;
  }) {
    this.settings = input.settings;
    this.#pool = input.pool;
    this.#logger = input.logger;
    this.#tables = input.tables;
    this.client =
      input.client ??
      new RegistryClient({
        reference: input.settings.registry,
        credentials: input.settings.credentials,
        logger: input.logger,
      });
    this.#pull = input.pull ?? {};
    this.#now = input.now ?? (() => new Date());
  }

  /** The regions this node keeps: `MAP_DATA_REGIONS` and, with any of them, the world overview. */
  regions(): string[] {
    const listed = [...this.settings.regions];
    return listed.length === 0 ? [] : [...listed, worldRegion];
  }

  /** Whether the tables can be read and imported into (the loader is part of this version). */
  get importing(): boolean {
    return this.#tables !== null;
  }

  /** What the tables hold: every build of every region, or null without a loader. */
  async tableRows(): Promise<readonly RegionRow[] | null> {
    return this.#tables === null ? null : this.#tables.list();
  }

  /**
   * Refreshes one region. Never throws for a failed step (see `failures`);
   * rejects only when `signal` aborts it (a shutdown), after the download
   * under way has been deleted.
   */
  async refresh(region: string, signal: AbortSignal): Promise<RefreshOutcome> {
    const outcome: RefreshOutcome = {
      region,
      registry: null,
      build: null,
      pulled: null,
      keptNewer: false,
      tables: null,
      imported: null,
      removed: [],
      busy: false,
      failures: [],
    };
    const logger = this.#logger.child({ region });
    try {
      await withRegionLock(this.#pool, region, async (locked) => {
        if (!locked) {
          outcome.busy = true;
          logger.info("map region refresh skipped: another process is refreshing it");
          return;
        }
        await this.#refreshLocked(region, signal, outcome, logger);
      });
    } catch (error) {
      if (signal.aborted) throw error;
      outcome.failures.push(failureOf("volume", error));
      logger.warn({ stage: "volume", err: error }, "map region refresh failed");
    }
    this.#warnWhenOld(outcome, logger);
    return outcome;
  }

  async #refreshLocked(
    region: string,
    signal: AbortSignal,
    outcome: RefreshOutcome,
    logger: Logger,
  ): Promise<void> {
    const root = this.settings.dir;
    await removeStaleDownloads(root, region);
    let resolved: ResolvedManifest | null = null;
    let layout: ArtefactLayout | null = null;
    try {
      resolved = await this.client.resolve(region, signal);
      layout = readArtefactLayout(resolved, region, this.settings.maxBytes);
      outcome.registry = { buildId: layout.buildId, digest: layout.digest };
    } catch (error) {
      if (signal.aborted) throw error;
      this.#fail(outcome, logger, failureOf("registry", error));
    }

    const local = await listLocalBuilds(root, region);
    const newest = local[0] ?? null;
    let build =
      layout === null
        ? newest
        : (local.find((candidate) => candidate.digest === layout.digest) ?? null);
    if (resolved !== null && layout !== null && build === null) {
      if (newest !== null && newest.buildId > layout.buildId) {
        outcome.keptNewer = true;
        build = newest;
        logger.warn(
          { registryBuild: layout.buildId, localBuild: newest.name },
          "map region build kept: the registry's is older",
        );
      } else {
        const started = performance.now();
        try {
          build = await pullBuild({
            source: this.client,
            resolved,
            layout,
            root,
            signal,
            logger,
            ...this.#pull,
          });
          const seconds = Math.round((performance.now() - started) / 100) / 10;
          outcome.pulled = { bytes: layout.totalBytes, seconds };
          logger.info(
            { build: build.name, digest: build.digest, bytes: layout.totalBytes, seconds },
            "map region pulled",
          );
        } catch (error) {
          if (signal.aborted) throw error;
          this.#fail(outcome, logger, failureOf("download", error));
          build = newest;
        }
      }
    }
    outcome.build = build;

    // The volume keeps the build to serve and the one the tables served
    // before it, which open maps use until the next refresh (§2.7, §3.5);
    // without the tables to ask, its two newest builds.
    const keep = new Set<string>();
    if (build !== null) keep.add(build.digest);
    let keepNewest = keptBuilds;
    if (region === worldRegion) {
      outcome.tables = "none";
    } else if (this.#tables === null) {
      outcome.tables = build === null ? null : "unavailable";
    } else if (
      build !== null &&
      (await this.#import(region, build, signal, outcome, logger, keep))
    ) {
      keepNewest = 0;
    }
    outcome.removed = await pruneLocalBuilds(root, region, { newest: keepNewest, keep });
    if (outcome.failures.length === 0 && outcome.pulled === null && outcome.tables !== "imported") {
      logger.info({ build: build?.name ?? null }, "map region up to date");
    }
  }

  /** Imports `build` unless the tables hold it; true when the tables could be read, so that the volume keeps what they served. */
  async #import(
    region: string,
    build: LocalBuild,
    signal: AbortSignal,
    outcome: RefreshOutcome,
    logger: Logger,
    keep: Set<string>,
  ): Promise<boolean> {
    const tables = this.#tables;
    if (tables === null) return false;
    let ready: RegionRow[];
    try {
      ready = (await tables.list()).filter((row) => row.name === region && row.status === "ready");
    } catch (error) {
      if (signal.aborted) throw error;
      outcome.failures.push(failureOf("import", error));
      logger.error({ build: build.name, err: error }, "map region import failed");
      return false;
    }
    // What served before stays on the volume, whatever happens to the import.
    for (const row of ready) keep.add(row.digest);
    if (ready.some((row) => row.digest === build.digest)) {
      outcome.tables = "current";
      return true;
    }
    try {
      const started = performance.now();
      const imported = await tables.import({ dir: build.dir, digest: build.digest, signal });
      outcome.imported = imported;
      outcome.tables = imported.imported ? "imported" : "current";
      if (imported.imported) {
        logger.info(
          {
            build: build.name,
            ways: imported.ways,
            pois: imported.pois,
            seconds: Math.round((performance.now() - started) / 100) / 10,
          },
          "map region imported",
        );
      }
    } catch (error) {
      if (signal.aborted) throw error;
      outcome.failures.push(failureOf("import", error));
      logger.error({ build: build.name, err: error }, "map region import failed");
    }
    return true;
  }

  #fail(outcome: RefreshOutcome, logger: Logger, failure: RefreshFailure): void {
    outcome.failures.push(failure);
    logger.warn(
      { stage: failure.stage, reason: failure.reason, message: failure.message },
      "map region refresh failed",
    );
  }

  /** A region whose data is older than three refresh periods: the refresh keeps failing. */
  #warnWhenOld(outcome: RefreshOutcome, logger: Logger): void {
    const timestamp = outcome.build?.extractTimestamp ?? null;
    const extract = timestamp === null ? Number.NaN : Date.parse(timestamp);
    if (!Number.isFinite(extract)) return;
    const days = Math.floor((this.#now().getTime() - extract) / dayMs);
    if (days > 3 * this.settings.refreshDays) {
      logger.warn(
        { build: outcome.build?.name ?? null, extract: timestamp, days },
        "map region data is old",
      );
    }
  }
}
