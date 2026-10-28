import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readFile, rename, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import {
  type ArtefactLayout,
  checkTrailManifest,
  type Layer,
  type PlannedFile,
} from "./artefactLayout";
import { type BlobSource, downloadBlob } from "./downloadBlob";
import {
  buildName,
  downloadPrefix,
  downloadsDirectory,
  type LocalBuild,
  listLocalBuilds,
  ociManifestFile,
  regionDirectory,
} from "./localBuilds";
import type { ResolvedManifest } from "./registry";
import { RegistryError } from "./registryError";

/** Left free on the volume after a download, for the database's neighbours and the logs. */
const reserveBytes = 256 * 1024 * 1024;

export interface PullOptions {
  source: BlobSource;
  resolved: ResolvedManifest;
  layout: ArtefactLayout;
  /** `MAP_DATA_DIR`. */
  root: string;
  signal: AbortSignal;
  logger: Logger;
  /** For tests: the download's patience and the free space. */
  download?: {
    attempts?: number;
    idleTimeoutMs?: number;
    deadlineMs?: number;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  };
  freeBytes?: (path: string) => Promise<number>;
}

const diskError = (message: string, cause: unknown): RegistryError =>
  new RegistryError(message, { reason: "disk", cause });

async function freeBytesOf(path: string): Promise<number> {
  const stats = await statfs(path);
  return stats.bavail * stats.bsize;
}

/** Writes a file's layers one after the other and checks the whole file when it came in chunks. */
async function downloadFile(
  options: PullOptions,
  path: string,
  layers: readonly Layer[],
  sha256: string,
): Promise<void> {
  const file = await open(path, "w");
  try {
    let position = 0;
    for (const layer of layers) {
      await downloadBlob({
        source: options.source,
        layer,
        file,
        position,
        signal: options.signal,
        logger: options.logger,
        ...options.download,
      });
      position += layer.size;
    }
    await file.sync();
  } finally {
    await file.close();
  }
  if (layers.length === 1) return;
  // The chunks are right one by one; the file they make is checked against manifest.json.
  const whole = await sha256Of(path, options.signal);
  if (whole !== sha256) {
    throw new RegistryError(
      `the chunks of ${path} make a file with the SHA-256 ${whole}, not ${sha256}`,
      {
        reason: "digest",
      },
    );
  }
}

async function sha256Of(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * The same file in a build already on the volume (a rebuild of the same
 * extract has the same data files, byte for byte): linked into the
 * download instead of fetched again, and hashed before it counts.
 */
async function reuseFile(
  options: PullOptions,
  builds: readonly LocalBuild[],
  path: string,
  file: PlannedFile,
  sha256: string,
): Promise<boolean> {
  for (const build of builds) {
    let listed = false;
    try {
      const manifest = JSON.parse(await readFile(join(build.dir, "manifest.json"), "utf8")) as {
        files?: { name?: unknown; bytes?: unknown; sha256?: unknown }[];
      };
      listed = (manifest.files ?? []).some(
        (entry) =>
          entry.name === file.name && entry.bytes === file.bytes && entry.sha256 === sha256,
      );
    } catch {
      listed = false;
    }
    const candidate = join(build.dir, file.name);
    // A regular file of that size only: a link is never followed out of the build.
    const found = listed ? await lstat(candidate).catch(() => null) : null;
    if (found === null || !found.isFile() || found.size !== file.bytes) continue;
    await link(candidate, path).catch(() => copyFile(candidate, path));
    if ((await sha256Of(path, options.signal)) === sha256) return true;
    await rm(path, { force: true });
  }
  return false;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** A pulled build, and how many of its bytes came over the network. */
export interface PulledBuild {
  build: LocalBuild;
  downloadedBytes: number;
}

/**
 * Pulls a build into `regions/<region>/<yyyymmdd>-<digest8>/` (docs/design/self-hosted-maps.md
 * §4.3): `manifest.json` first, checked against the layers, then every other
 * file into a directory of its own in `tmp/`, each blob checked against its
 * digest as it streams in, chunks put together and checked against the
 * manifest's SHA-256, the registry's manifest beside them as
 * `oci-manifest.json`, everything synced, and the directory renamed into
 * place in one step. A file that a build on the volume holds already is
 * linked from there and hashed instead of fetched. Anything wrong deletes
 * the download and leaves every build already on the volume as it was. A
 * build already there is returned as it is.
 */
export async function pullBuild(options: PullOptions): Promise<PulledBuild> {
  const { layout, resolved, root, logger } = options;
  const name = buildName(layout.buildId, layout.digest);
  const builds = await listLocalBuilds(root, layout.region);
  const existing = builds.find((build) => build.digest === layout.digest);
  if (existing !== undefined) return { build: existing, downloadedBytes: 0 };

  const tmpRoot = downloadsDirectory(root);
  try {
    await mkdir(tmpRoot, { recursive: true });
    await mkdir(regionDirectory(root, layout.region), { recursive: true });
  } catch (error) {
    throw diskError(`MAP_DATA_DIR (${root}) is not writable: ${String(error)}`, error);
  }
  const free = await (options.freeBytes ?? freeBytesOf)(tmpRoot);
  if (free < layout.totalBytes + reserveBytes) {
    throw new RegistryError(
      `the build ${name} of ${layout.region} needs ${Math.ceil(layout.totalBytes / 1e6)} MB, and ${Math.floor(free / 1e6)} MB are free in MAP_DATA_DIR`,
      { reason: "too_large" },
    );
  }

  const tmp = join(
    tmpRoot,
    `${downloadPrefix(layout.region)}${name}-${randomBytes(4).toString("hex")}`,
  );
  const started = performance.now();
  try {
    await mkdir(tmp);
    const manifestPath = join(tmp, "manifest.json");
    await downloadFile(options, manifestPath, [layout.manifest], layout.manifest.digest.slice(7));
    const handle = await open(manifestPath, "r");
    let manifestBytes: Buffer;
    try {
      manifestBytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    const trailManifest = checkTrailManifest(layout, manifestBytes);
    let downloadedBytes = layout.manifest.size;
    for (const file of layout.files) {
      const path = join(tmp, file.name);
      const sha256 = trailManifest.sha256.get(file.name) ?? "";
      if (await reuseFile(options, builds, path, file, sha256)) {
        logger.debug(
          { region: layout.region, file: file.name },
          "map data file taken from the volume",
        );
        continue;
      }
      await downloadFile(options, path, file.layers, sha256);
      downloadedBytes += file.bytes;
      logger.debug(
        { region: layout.region, file: file.name, bytes: file.bytes },
        "map data file downloaded",
      );
    }
    const ociManifest = await open(join(tmp, ociManifestFile), "wx");
    try {
      await ociManifest.writeFile(resolved.bytes);
      await ociManifest.sync();
    } finally {
      await ociManifest.close();
    }
    await syncDirectory(tmp);
    const target = join(regionDirectory(root, layout.region), name);
    try {
      await rename(tmp, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
      const pulled = (await listLocalBuilds(root, layout.region)).some(
        (build) => build.digest === layout.digest,
      );
      if (pulled) {
        // Another process pulled the same build first: theirs is as good as this one.
        await rm(tmp, { recursive: true, force: true });
      } else {
        // A directory of that name that is not a complete build: never one the client renamed.
        await rm(target, { recursive: true, force: true });
        await rename(tmp, target);
      }
    }
    await syncDirectory(regionDirectory(root, layout.region));
    const build = (await listLocalBuilds(root, layout.region)).find(
      (candidate) => candidate.digest === layout.digest,
    );
    if (build === undefined) {
      throw diskError(
        `the build ${name} of ${layout.region} is not on the volume after its rename`,
        null,
      );
    }
    logger.debug(
      { region: layout.region, build: name, ms: Math.round(performance.now() - started) },
      "map data build renamed into place",
    );
    return { build, downloadedBytes };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof RegistryError || options.signal.aborted) throw error;
    throw diskError(`pulling ${name} of ${layout.region} failed: ${String(error)}`, error);
  }
}
