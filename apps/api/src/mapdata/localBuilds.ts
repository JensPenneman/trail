import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isBuildId } from "./artefactLayout";
import { isRegionName } from "./regionName";

/** The registry's manifest of a pulled build, byte for byte: its SHA-256 is the build's digest. */
export const ociManifestFile = "oci-manifest.json";

/** A build on the volume, `regions/<region>/<yyyymmdd>-<digest8>/`, as the registry client left it. */
export interface LocalBuild {
  region: string;
  /** `yyyymmdd`, the extract's date. */
  buildId: string;
  /** `sha256:<hex>` of `oci-manifest.json`: what identifies the build. */
  digest: string;
  /** `<yyyymmdd>-<first 8 hex of the digest>`, the directory's name. */
  name: string;
  dir: string;
  /** When it was pulled. */
  pulledAt: Date;
  /** Its files together. */
  bytes: number;
  /** Of them, in files another build links too (a rebuild's unchanged files): on the volume once. */
  sharedBytes: number;
  /** The extract's time from its manifest.json, or null when it does not say. */
  extractTimestamp: string | null;
}

const buildNamePattern = /^(\d{8})-([0-9a-f]{8})$/;
const maxOciManifestBytes = 256 * 1024;
const maxManifestBytes = 1024 * 1024;

/** `20261027-1a2b3c4d`: the extract's date for people, the digest's start to tell rebuilds apart. */
export const buildName = (buildId: string, digest: string): string =>
  `${buildId}-${digest.slice("sha256:".length, "sha256:".length + 8)}`;

export const regionDirectory = (root: string, region: string): string =>
  join(root, "regions", region);

/** Downloads under way: next to the builds, so that a finished one is renamed into place. */
export const downloadsDirectory = (root: string): string => join(root, "tmp");

/**
 * A download's directory in `tmp/` starts with this: `belgium@`. A region
 * name has no `@`, so no region's prefix is the start of another's.
 */
export const downloadPrefix = (region: string): string => `${region}@`;

async function readSmallFile(path: string, max: number): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    // Never through a link: a build's files are its own.
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const { size } = await handle.stat();
    if (size > max) return null;
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/** The regions that have a directory on the volume. */
export async function listLocalRegions(root: string): Promise<string[]> {
  const entries = await readdir(join(root, "regions"), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && isRegionName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function readBuild(root: string, region: string, name: string): Promise<LocalBuild | null> {
  const match = buildNamePattern.exec(name);
  const buildId = match?.[1];
  if (match === null || buildId === undefined || !isBuildId(buildId)) return null;
  const dir = join(regionDirectory(root, region), name);
  const ociManifest = await readSmallFile(join(dir, ociManifestFile), maxOciManifestBytes);
  if (ociManifest === null) return null;
  const digest = `sha256:${createHash("sha256").update(ociManifest).digest("hex")}`;
  if (buildName(buildId, digest) !== name) return null;
  let extractTimestamp: string | null = null;
  const manifest = await readSmallFile(join(dir, "manifest.json"), maxManifestBytes);
  try {
    const parsed = JSON.parse(manifest?.toString("utf8") ?? "null") as {
      extract?: { timestamp?: unknown };
    } | null;
    const timestamp = parsed?.extract?.timestamp;
    if (typeof timestamp === "string") extractTimestamp = timestamp;
  } catch {
    extractTimestamp = null;
  }
  let bytes = 0;
  let sharedBytes = 0;
  let pulledAt = new Date(0);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const stats = await lstat(join(dir, entry.name));
    bytes += stats.size;
    if (stats.nlink > 1) sharedBytes += stats.size;
    if (entry.name === ociManifestFile) pulledAt = stats.mtime;
  }
  return { region, buildId, digest, name, dir, pulledAt, bytes, sharedBytes, extractTimestamp };
}

/**
 * The region's builds on the volume, newest first (by the extract's date,
 * then by when they were pulled). A directory that is not a complete pull —
 * no `oci-manifest.json`, or one whose digest does not match its name — is
 * not a build: the client only ever renames a verified download into place.
 */
export async function listLocalBuilds(root: string, region: string): Promise<LocalBuild[]> {
  const entries = await readdir(regionDirectory(root, region), { withFileTypes: true }).catch(
    () => [],
  );
  const builds: LocalBuild[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const build = await readBuild(root, region, entry.name);
    if (build !== null) builds.push(build);
  }
  return builds.sort(
    (a, b) => b.buildId.localeCompare(a.buildId) || b.pulledAt.getTime() - a.pulledAt.getTime(),
  );
}

/** What the builds take on the volume, every file counted once however many builds link it. */
export async function volumeBytes(root: string): Promise<number> {
  const seen = new Set<string>();
  let bytes = 0;
  for (const region of await listLocalRegions(root)) {
    for (const build of await listLocalBuilds(root, region)) {
      for (const entry of await readdir(build.dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const stats = await lstat(join(build.dir, entry.name));
        const key = `${stats.dev}:${stats.ino}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bytes += stats.size;
      }
    }
  }
  return bytes;
}

/**
 * Deletes the region's builds beyond the `newest` ones, except those in
 * `keep` (the build the tables hold): the volume keeps the build in use and
 * the one before it (docs/design/self-hosted-maps.md §2.7).
 */
export async function pruneLocalBuilds(
  root: string,
  region: string,
  options: { newest: number; keep: ReadonlySet<string> },
): Promise<LocalBuild[]> {
  const builds = await listLocalBuilds(root, region);
  const removed: LocalBuild[] = [];
  for (const [index, build] of builds.entries()) {
    if (index < options.newest || options.keep.has(build.digest)) continue;
    await rm(build.dir, { recursive: true, force: true });
    removed.push(build);
  }
  return removed;
}

/** What an interrupted pull of the region left in `tmp/` (called while holding the region's lock). */
export async function removeStaleDownloads(root: string, region: string): Promise<void> {
  const tmp = downloadsDirectory(root);
  const entries = await readdir(tmp, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(downloadPrefix(region))) {
      await rm(join(tmp, entry.name), { recursive: true, force: true });
    }
  }
}
