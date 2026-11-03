import { join } from "node:path";
import type { Logger } from "pino";
import type { BasemapSettings } from "../config/config";
import { type LocalBuild, listLocalBuilds } from "../mapdata/localBuilds";
import { worldRegion } from "../mapdata/regionName";
import { ArchiveError, BasemapArchive } from "./basemapArchive";
import { type BasemapBundle, bundleId, type OpenBasemap } from "./basemapBundle";
import { plainStyle, renderStyle, type ServedStyle, type StyleName } from "./basemapStyles";
import { DirectoryCache } from "./directoryCache";
import type { MapAssets } from "./mapAssets";

/** What the map draws under Trail's layers (docs/design/self-hosted-maps.md §3.5). */
export type BasemapSource = "self" | "external" | "none";

/** What `/api/health` and `trail map status` say about the basemap. */
export interface BasemapState {
  /** `self`: Trail's tiles; `external`: `MAP_STYLE_LIGHT`/`DARK`; `none`: a plain ground. */
  source: BasemapSource;
  /** The bundle in the tile URLs, while there is one. */
  bundle: string | null;
  /** `<region> <build>` of the region's archive, and the build of the world overview's. */
  region: string | null;
  world: string | null;
  /** The image has fonts and sprites for the styles (`scripts/map-assets.mjs`). */
  assets: boolean;
}

const basemapFile = "basemap.pmtiles";
/** The directories of every open archive together, by the cache's estimate. */
const defaultCacheBytes = 10 * 1024 * 1024;
/** The refresh runs in this process or in `trail map refresh`: either is seen within a minute. */
const defaultRescanMs = 60_000;

const plain: Readonly<Record<StyleName, ServedStyle>> = {
  light: plainStyle("light"),
  dark: plainStyle("dark"),
};

/**
 * The basemap this process serves (docs/design/self-hosted-maps.md §3.3):
 * the newest build of `MAP_BASEMAP_REGION` on the map data volume whose
 * `basemap.pmtiles` opens and checks, with the newest world overview, as
 * one bundle. The volume is looked at on start, every minute and after a
 * refresh of this process, so a build the refresh renames into place serves
 * within a minute, whichever process pulled it. Bundles served before stay
 * served while their builds are on the volume — the refresh keeps the one
 * before for a period — so maps opened on them load their tiles until they
 * reload, also across the region's and the overview's refreshes, which come
 * minutes apart; a bundle whose build is gone is dropped at the next look
 * and its archives closed. Nothing of a request reaches the file system: a
 * tile is asked of an open archive by its bundle's id and its numbers.
 */
export class Basemap {
  readonly settings: BasemapSettings;
  /** The image's fonts and sprites; null without them (the styles need them, so the fallback serves). */
  readonly assets: MapAssets | null;
  readonly #dir: string;
  /** `PUBLIC_URL` without a trailing slash: the origin the styles' URLs are on. */
  readonly #origin: string;
  readonly #logger: Logger;
  readonly #cache: DirectoryCache;
  readonly #rescanMs: number;
  /** Open archives, by their build's digest. */
  readonly #open = new Map<string, OpenBasemap>();
  /** Builds whose archive is no basemap Trail can serve: said once, never tried again. */
  readonly #refused = new Set<string>();
  /** Builds whose archive could not be read: said once, tried again at every look. */
  readonly #unreadable = new Set<string>();
  /** Archives no bundle uses any more, closing once their reads are done. */
  readonly #closing = new Set<Promise<void>>();
  #current: BasemapBundle | null = null;
  /** Every bundle served: the current one and those before it whose builds are on the volume. */
  readonly #bundles = new Map<string, BasemapBundle>();
  #styles: Record<StyleName, ServedStyle> | null = null;
  #scanning: Promise<void> | null = null;
  #again = false;
  #timer: NodeJS.Timeout | null = null;
  #stopped = false;

  constructor(input: {
    settings: BasemapSettings;
    /** `MAP_DATA_DIR`. */
    dir: string;
    /** `PUBLIC_URL`. */
    publicUrl: string;
    assets: MapAssets | null;
    logger: Logger;
    /** For tests: the directory cache's size and the time between looks at the volume. */
    cacheBytes?: number;
    rescanMs?: number;
  }) {
    this.settings = input.settings;
    this.assets = input.assets;
    this.#dir = input.dir;
    this.#origin = input.publicUrl.replace(/\/+$/, "");
    this.#logger = input.logger;
    this.#cache = new DirectoryCache(input.cacheBytes ?? defaultCacheBytes);
    this.#rescanMs = input.rescanMs ?? defaultRescanMs;
  }

  /** The first look at the volume, then one every minute; resolves after the first. */
  async start(): Promise<void> {
    await this.rescan();
    if (this.#stopped || !this.#serves()) return;
    if (this.#current === null) {
      this.#logger.info(
        { region: this.settings.region, fallback: this.settings.fallback },
        "basemap: none on the volume yet",
      );
    }
    this.#timer = setInterval(() => void this.rescan(), this.#rescanMs);
    this.#timer.unref();
  }

  /** No more looks; every archive is closed once its reads are done. */
  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    await this.#scanning;
    this.#current = null;
    this.#bundles.clear();
    this.#styles = null;
    for (const digest of [...this.#open.keys()]) this.#close(digest);
    await Promise.all([...this.#closing]);
  }

  /** Looks at the volume now; a look asked for while one runs runs again after it. */
  rescan(): Promise<void> {
    if (this.#scanning !== null) {
      this.#again = true;
      return this.#scanning;
    }
    this.#scanning = (async () => {
      do {
        this.#again = false;
        await this.#scan();
      } while (this.#again && !this.#stopped);
    })().finally(() => {
      this.#scanning = null;
    });
    return this.#scanning;
  }

  /** What the map draws now. */
  source(): BasemapSource {
    if (this.settings.mode === "openfreemap") return "external";
    if (this.#styles !== null) return "self";
    return this.settings.fallback ? "external" : "none";
  }

  state(): BasemapState {
    const current = this.#current;
    return {
      source: this.source(),
      bundle: current?.id ?? null,
      region:
        current === null ? null : `${current.region.build.region} ${current.region.build.name}`,
      world: current?.world?.build.name ?? null,
      assets: this.assets !== null,
    };
  }

  /** `/map/styles/<name>.json`: the bundle's style, or the plain ground without one. */
  style(name: StyleName): ServedStyle {
    return this.#styles?.[name] ?? plain[name];
  }

  /** A bundle by its id: the current one or one before it still on the volume; null for any other. */
  bundle(id: string): BasemapBundle | null {
    return this.#bundles.get(id) ?? null;
  }

  #serves(): boolean {
    return this.settings.mode === "self" && this.settings.region !== null;
  }

  async #scan(): Promise<void> {
    const { region } = this.settings;
    if (this.#stopped || !this.#serves() || region === null) return;
    try {
      const regionBuilds = await listLocalBuilds(this.#dir, region);
      const worldBuilds = await listLocalBuilds(this.#dir, worldRegion);
      const regional = await this.#newest(region, regionBuilds);
      const world = regional === null ? null : await this.#newest(worldRegion, worldBuilds);
      const onVolume = new Set([...regionBuilds, ...worldBuilds].map((build) => build.digest));
      if (!this.#stopped) this.#switch(regional, world, onVolume);
    } catch (error) {
      // The volume could not be read now: what serves keeps serving.
      this.#logger.warn({ err: error }, "basemap: the map data volume could not be read");
    }
  }

  /** The newest of the region's builds whose basemap opens: open already, or opened now. */
  async #newest(region: string, builds: readonly LocalBuild[]): Promise<OpenBasemap | null> {
    for (const build of builds) {
      const known = this.#open.get(build.digest);
      if (known !== undefined) return known;
      if (this.#refused.has(build.digest)) continue;
      try {
        const archive = await BasemapArchive.open({
          path: join(build.dir, basemapFile),
          key: build.digest,
          cache: this.#cache,
        });
        const opened = { build, archive };
        this.#open.set(build.digest, opened);
        return opened;
      } catch (error) {
        // A build without a basemap (one built by hand) is no build of the map: the next one may be.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        const refused = error instanceof ArchiveError;
        const said = refused ? this.#refused : this.#unreadable;
        if (!said.has(build.digest)) {
          this.#logger.warn(
            { region, build: build.name, err: error },
            refused
              ? "basemap: the build's basemap.pmtiles was refused"
              : "basemap: the build's basemap.pmtiles could not be read",
          );
        }
        said.add(build.digest);
      }
    }
    return null;
  }

  #switch(
    region: OpenBasemap | null,
    world: OpenBasemap | null,
    onVolume: ReadonlySet<string>,
  ): void {
    const next: BasemapBundle | null =
      region === null ? null : { id: bundleId(region.build, world?.build ?? null), region, world };
    if ((next?.id ?? null) !== (this.#current?.id ?? null)) {
      this.#current = next;
      this.#styles =
        next === null || this.assets === null
          ? null
          : {
              light: renderStyle("light", {
                bundle: next.id,
                assets: this.assets.hash,
                origin: this.#origin,
              }),
              dark: renderStyle("dark", {
                bundle: next.id,
                assets: this.assets.hash,
                origin: this.#origin,
              }),
            };
      if (next === null) {
        this.#logger.info(
          { region: this.settings.region, fallback: this.settings.fallback },
          "basemap: none on the volume",
        );
      } else {
        this.#logger.info(
          {
            bundle: next.id,
            region: next.region.build.name,
            world: next.world?.build.name ?? null,
          },
          "basemap: serving a new bundle",
        );
        if (this.assets === null) {
          this.#logger.warn(
            "basemap: the image has no map fonts or sprites (scripts/map-assets.mjs): the map uses its fallback",
          );
        }
      }
    }
    if (next !== null) this.#bundles.set(next.id, next);
    // Bundles before it serve on while their builds do: the refresh deletes the older ones.
    for (const [id, bundle] of this.#bundles) {
      if (id === next?.id) continue;
      const builds = [bundle.region, ...(bundle.world === null ? [] : [bundle.world])];
      if (builds.some((basemap) => !onVolume.has(basemap.build.digest))) this.#bundles.delete(id);
    }
    this.#closeUnused();
  }

  /** Closes the archives no bundle served uses any more. */
  #closeUnused(): void {
    const used = new Set<string>();
    for (const bundle of this.#bundles.values()) {
      used.add(bundle.region.build.digest);
      if (bundle.world !== null) used.add(bundle.world.build.digest);
    }
    for (const digest of [...this.#open.keys()]) {
      if (!used.has(digest)) this.#close(digest);
    }
  }

  #close(digest: string): void {
    const basemap = this.#open.get(digest);
    if (basemap === undefined) return;
    this.#open.delete(digest);
    const closing = basemap.archive
      .close()
      .catch((error: unknown) => {
        this.#logger.warn({ build: basemap.build.name, err: error }, "basemap: closing failed");
      })
      .finally(() => this.#closing.delete(closing));
    this.#closing.add(closing);
  }
}
