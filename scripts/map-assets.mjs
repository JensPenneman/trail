/* The map's fonts and sprites (docs/design/self-hosted-maps.md §3.2): the
 * files scripts/map-assets.json pins by SHA-256, fetched once into a cache
 * and laid out for the API, which serves them under /map/assets/<hash>/:
 *
 *   <out>/<hash>/fonts/<stack>/<start>-<end>.pbf   the glyph ranges MapLibre asks for
 *   <out>/<hash>/sprites/ofm{,@2x}.{json,png}      the sprite sheet
 *   <out>/assets.json                              {hash, fonts}, written last
 *
 * <hash> is the first 16 hex digits of map-assets.json's SHA-256. The fonts
 * come as one zip of glyph PBFs (openmaptiles/fonts), read here without a
 * library: the central directory, then each wanted entry inflated and
 * checked against its CRC-32 and size. Only entries named
 * `<listed stack>/<start>-<end>.pbf` are read, and the output paths are made
 * of those parsed names, so nothing in the zip chooses a path.
 *
 *   node scripts/map-assets.mjs download         fill the cache (the image's cached layer)
 *   node scripts/map-assets.mjs write <out>      lay them out (scripts/build.mjs, npm run dev)
 *
 * The cache is TRAIL_MAP_ASSETS_CACHE or node_modules/.cache/trail-map-assets,
 * one file per SHA-256; a file there is hashed again before it is used. */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";

const manifestPath = fileURLToPath(new URL("map-assets.json", import.meta.url));
const defaultCache = fileURLToPath(
  new URL("../node_modules/.cache/trail-map-assets", import.meta.url),
);

/**
 * @typedef {{ bytes: number; sha256: string }} PinnedFile
 * @typedef {{
 *   fonts: { url: string; stacks: string[]; drawnByMapLibre: { blocks: string[] } } & PinnedFile;
 *   sprites: { url: string; files: Record<string, PinnedFile> };
 * }} AssetManifest
 */

/** @param {Buffer | string} bytes */
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** @returns {Promise<{ manifest: AssetManifest; hash: string }>} */
async function readManifest() {
  const bytes = await readFile(manifestPath);
  return { manifest: JSON.parse(bytes.toString("utf8")), hash: sha256(bytes).slice(0, 16) };
}

/** @param {string} path @returns {Promise<string | null>} */
async function hashOf(path) {
  try {
    return sha256(await readFile(path));
  } catch {
    return null;
  }
}

/** A download that is not the pinned file: never tried again. */
class PinError extends Error {}

/**
 * The cached copy of a pinned file, fetched first when the cache lacks it.
 *
 * @param {string} cache @param {string} url @param {PinnedFile} pinned
 * @returns {Promise<string>}
 */
async function cached(cache, url, pinned) {
  const path = join(cache, pinned.sha256);
  if ((await hashOf(path)) === pinned.sha256) return path;
  await mkdir(cache, { recursive: true });
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const got = Buffer.from(await response.arrayBuffer());
      const digest = sha256(got);
      if (got.byteLength !== pinned.bytes || digest !== pinned.sha256) {
        throw new PinError(
          `${url}: ${got.byteLength} bytes with the SHA-256 ${digest}, not the pinned ${pinned.bytes} bytes ${pinned.sha256}`,
        );
      }
      const partial = `${path}.${randomBytes(4).toString("hex")}.part`;
      await writeFile(partial, got);
      await rename(partial, path);
      return path;
    } catch (error) {
      if (attempt >= 3 || error instanceof PinError) throw error;
      console.error(`map-assets: ${url} failed (${String(error)}), trying again`);
    }
  }
}

/** @param {string} cache */
async function download(cache) {
  const { manifest } = await readManifest();
  const fonts = await cached(cache, manifest.fonts.url, manifest.fonts);
  /** @type {Record<string, string>} */
  const sprites = {};
  for (const [name, pinned] of Object.entries(manifest.sprites.files)) {
    sprites[name] = await cached(cache, new URL(name, manifest.sprites.url).href, pinned);
  }
  return { manifest, fonts, sprites };
}

/**
 * The entries of a zip without ZIP64 (the pinned one has 771): names, where
 * their data starts, and how it is stored.
 *
 * @param {Buffer} zip
 */
function zipEntries(zip) {
  const tail = zip.subarray(Math.max(0, zip.length - 65_557));
  const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("the fonts' zip has no end of central directory");
  const count = tail.readUInt16LE(end + 10);
  let at = tail.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("the fonts' zip is damaged");
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localHeader = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localHeader === 0xffffffff) {
      throw new Error("the fonts' zip needs ZIP64, which this reader does not read");
    }
    if (zip.readUInt32LE(localHeader) !== 0x04034b50) throw new Error(`${name}: no local header`);
    const start =
      localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
    entries.push({ name, method, crc, size, data: zip.subarray(start, start + compressedSize) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** @param {string[]} blocks `02ea-02eb` … @returns {(start: number) => boolean} */
function drawnLocally(blocks) {
  const ranges = blocks.map((block) => block.split("-").map((hex) => Number.parseInt(hex, 16)));
  const local = (/** @type {number} */ codePoint) =>
    ranges.some(([from = 0, to = -1]) => codePoint >= from && codePoint <= to);
  return (start) => {
    for (let codePoint = start; codePoint < start + 256; codePoint += 1) {
      if (!local(codePoint)) return false;
    }
    return true;
  };
}

/**
 * Lays the assets out in `out` (see the top of this file) unless they are
 * there already; returns the hash and what was written.
 *
 * @param {string} out
 * @param {{ cache?: string }} [options]
 */
export async function writeMapAssets(out, options = {}) {
  const cache = options.cache ?? process.env["TRAIL_MAP_ASSETS_CACHE"] ?? defaultCache;
  const { hash } = await readManifest();
  const done = join(out, "assets.json");
  try {
    const current = JSON.parse(await readFile(done, "utf8"));
    if (current.hash === hash && existsSync(join(out, hash))) {
      return { hash, files: current.files, bytes: current.bytes, written: false };
    }
  } catch {
    // Not laid out yet.
  }
  const { manifest, fonts, sprites } = await download(cache);
  const stacks = new Set(manifest.fonts.stacks);
  const skip = drawnLocally(manifest.fonts.drawnByMapLibre.blocks);
  const staging = join(out, `.${hash}-${randomBytes(4).toString("hex")}`);
  /** @type {Map<string, number>} */
  const ranges = new Map();
  let files = 0;
  let bytes = 0;
  await mkdir(staging, { recursive: true });
  try {
    for (const entry of zipEntries(await readFile(fonts))) {
      const match = /^([A-Za-z0-9 ]{1,64})\/(\d{1,5})-(\d{1,5})\.pbf$/.exec(entry.name);
      const [, stack = "", from = "", to = ""] = match ?? [];
      const start = Number(from);
      if (match === null || !stacks.has(stack) || start % 256 !== 0 || Number(to) !== start + 255) {
        continue;
      }
      if (skip(start)) continue;
      const data =
        entry.method === 0
          ? entry.data
          : entry.method === 8
            ? inflateRawSync(entry.data, { maxOutputLength: entry.size })
            : null;
      if (data === null || data.length !== entry.size || crc32(data) !== entry.crc) {
        throw new Error(`${entry.name}: damaged in the fonts' zip`);
      }
      await mkdir(join(staging, "fonts", stack), { recursive: true });
      await writeFile(join(staging, "fonts", stack, `${start}-${start + 255}.pbf`), data);
      ranges.set(stack, (ranges.get(stack) ?? 0) + 1);
      files += 1;
      bytes += data.length;
    }
    for (const stack of stacks) {
      if ((ranges.get(stack) ?? 0) === 0) throw new Error(`the fonts' zip has no ${stack}`);
    }
    await mkdir(join(staging, "sprites"));
    for (const [name, path] of Object.entries(sprites)) {
      const data = await readFile(path);
      await writeFile(join(staging, "sprites", name), data);
      files += 1;
      bytes += data.length;
    }
    // Earlier hashes go: the API serves the image's one set.
    for (const entry of await readdir(out, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[0-9a-f]{16}$/.test(entry.name)) {
        await rm(join(out, entry.name), { recursive: true, force: true });
      }
    }
    await rm(done, { force: true });
    await rename(staging, join(out, hash));
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const fontsList = [...stacks].sort();
  await writeFile(`${done}.part`, `${JSON.stringify({ hash, fonts: fontsList, files, bytes })}\n`);
  await rename(`${done}.part`, done);
  return { hash, files, bytes, written: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, out] = process.argv.slice(2);
  if (command === "download" && out === undefined) {
    const cache = process.env["TRAIL_MAP_ASSETS_CACHE"] ?? defaultCache;
    await download(cache);
    console.log(`map-assets: the pinned files are in ${cache}`);
  } else if (command === "write" && out !== undefined) {
    const result = await writeMapAssets(out);
    console.log(
      `map-assets: ${result.files} files, ${(result.bytes / 1e6).toFixed(1)} MB in ${join(out, result.hash)}`,
    );
  } else {
    console.error("usage: node scripts/map-assets.mjs download | write <out>");
    process.exit(2);
  }
}
