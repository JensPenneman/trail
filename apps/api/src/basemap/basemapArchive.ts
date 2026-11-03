import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { Compression, findTile, type Header, TileType, zxyToTileId } from "pmtiles";
import { ArchiveFileSource } from "./archiveFileSource";
import type { DirectoryCache } from "./directoryCache";

/** A tile larger than this is a broken archive (docs/design/self-hosted-maps.md §7). */
export const maxTileBytes = 2 * 1024 * 1024;
/** PMTiles nests leaf directories at most this deep. */
const maxDepth = 3;

/** An archive that is not a basemap Trail can serve. */
export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

/** A read of an archive that is closed: the bundle it belonged to is gone. */
export class ArchiveClosedError extends ArchiveError {
  constructor() {
    super("the archive is closed");
    this.name = "ArchiveClosedError";
  }
}

/** How the archive stores its tiles: what a tile's answer says in `Content-Encoding`. */
export type TileCompression = "gzip" | "none";

/** A tile as the archive stores it. */
export interface StoredTile {
  data: Buffer;
  compression: TileCompression;
}

const within = (offset: number, length: number, size: number): boolean =>
  offset >= 0 && length >= 0 && offset + length <= size;

/** The header's promises the reads rely on; anything else is refused before a tile is served. */
function checkHeader(header: Header, size: number): TileCompression {
  if (header.specVersion !== 3) {
    throw new ArchiveError(`PMTiles version ${header.specVersion}, not 3`);
  }
  if (header.tileType !== TileType.Mvt) {
    throw new ArchiveError(`tiles of type ${TileType[header.tileType]}, not vector tiles (MVT)`);
  }
  const stored = [Compression.None, Compression.Gzip];
  if (!stored.includes(header.internalCompression) || !stored.includes(header.tileCompression)) {
    throw new ArchiveError("compressed otherwise than with gzip");
  }
  if (header.minZoom > header.maxZoom || header.maxZoom > 30) {
    throw new ArchiveError(`zooms ${header.minZoom}–${header.maxZoom}`);
  }
  const sections: [string, number, number | undefined][] = [
    ["root directory", header.rootDirectoryOffset, header.rootDirectoryLength],
    ["leaf directories", header.leafDirectoryOffset, header.leafDirectoryLength],
    ["tile data", header.tileDataOffset, header.tileDataLength],
  ];
  for (const [name, offset, length] of sections) {
    if (length === undefined || !within(offset, length, size)) {
      throw new ArchiveError(`its ${name} lie outside the file`);
    }
  }
  return header.tileCompression === Compression.Gzip ? "gzip" : "none";
}

/**
 * One `basemap.pmtiles` of the volume, open for reading
 * (docs/design/self-hosted-maps.md §3.3): its file handle is opened once —
 * never through a link — and kept, so the file serves on even after a
 * refresh deleted its build, until the archive is closed. The `pmtiles`
 * package parses and checks the header and directories (in the shared
 * `DirectoryCache`); the tiles are read here as they are stored, still
 * gzipped, and checked against the tile data section and the 2 MB cap.
 */
export class BasemapArchive {
  readonly #handle: FileHandle;
  readonly #source: ArchiveFileSource;
  readonly #cache: DirectoryCache;
  readonly #header: Header;
  readonly compression: TileCompression;
  /** Reads under way and references held (`acquire`): a close waits for all of them. */
  #reads = 0;
  #held = 0;
  #closing: (() => void) | null = null;
  #closed: Promise<void> | null = null;

  private constructor(input: {
    handle: FileHandle;
    source: ArchiveFileSource;
    cache: DirectoryCache;
    header: Header;
    compression: TileCompression;
  }) {
    this.#handle = input.handle;
    this.#source = input.source;
    this.#cache = input.cache;
    this.#header = input.header;
    this.compression = input.compression;
  }

  /** Opens and checks an archive; `key` names it in the cache (its build's digest). */
  static async open(input: {
    path: string;
    key: string;
    cache: DirectoryCache;
  }): Promise<BasemapArchive> {
    const handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new ArchiveError("not a regular file");
      const source = new ArchiveFileSource(handle, stats.size, input.key);
      let header: Header;
      try {
        header = await input.cache.getHeader(source);
      } catch (error) {
        // The file could not be read (a system error): no verdict on the archive.
        if ((error as NodeJS.ErrnoException).code !== undefined) throw error;
        throw new ArchiveError(
          `not a PMTiles archive: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const compression = checkHeader(header, stats.size);
      return new BasemapArchive({ handle, source, cache: input.cache, header, compression });
    } catch (error) {
      input.cache.forget(input.key);
      await handle.close();
      throw error;
    }
  }

  get minZoom(): number {
    return this.#header.minZoom;
  }

  get maxZoom(): number {
    return this.#header.maxZoom;
  }

  /** The tile as stored, or null when the archive has none there (outside it, or empty). */
  async tile(z: number, x: number, y: number): Promise<StoredTile | null> {
    // A close asked for lets the holders of a reference go on reading.
    if (this.#closing !== null && this.#held === 0) throw new ArchiveClosedError();
    const header = this.#header;
    if (z < header.minZoom || z > header.maxZoom) return null;
    this.#reads += 1;
    try {
      const tileId = zxyToTileId(z, x, y);
      let offset = header.rootDirectoryOffset;
      let length = header.rootDirectoryLength;
      for (let depth = 0; depth <= maxDepth; depth += 1) {
        const directory = await this.#cache.getDirectory(this.#source, offset, length, header);
        const entry = findTile(directory, tileId);
        if (entry === null) return null;
        if (entry.runLength > 0) return await this.#read(entry.offset, entry.length);
        // A leaf directory: inside the leaf section, or the archive is broken.
        if (!within(entry.offset, entry.length, header.leafDirectoryLength ?? 0)) {
          throw new ArchiveError("a leaf directory lies outside its section");
        }
        offset = header.leafDirectoryOffset + entry.offset;
        length = entry.length;
      }
      throw new ArchiveError(`directories nested deeper than ${maxDepth}`);
    } finally {
      this.#released();
    }
  }

  /**
   * A reference for a series of reads: the file stays open until it is
   * released, also when a close is asked for meanwhile. Throws
   * `ArchiveClosedError` when the archive is closed already; call the result
   * once when done.
   */
  acquire(): () => void {
    if (this.#closing !== null && this.#held === 0) throw new ArchiveClosedError();
    this.#reads += 1;
    this.#held += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#held -= 1;
      this.#released();
    };
  }

  /** A read is done: the last one lets a pending close go ahead. */
  #released(): void {
    this.#reads -= 1;
    if (this.#reads === 0) this.#closing?.();
  }

  async #read(offset: number, length: number): Promise<StoredTile | null> {
    const header = this.#header;
    if (length === 0) return null;
    if (length > maxTileBytes) throw new ArchiveError(`a tile of ${length} bytes`);
    if (!within(offset, length, header.tileDataLength ?? 0)) {
      throw new ArchiveError("a tile lies outside the tile data");
    }
    const { data } = await this.#source.getBytes(header.tileDataOffset + offset, length);
    return { data: Buffer.from(data), compression: this.compression };
  }

  /** Closes the file once the reads under way are done; reads after this are refused. */
  close(): Promise<void> {
    if (this.#closed !== null) return this.#closed;
    this.#closed = new Promise<void>((resolve) => {
      this.#closing = resolve;
      if (this.#reads === 0) resolve();
    }).then(async () => {
      this.#cache.forget(this.#source.getKey());
      await this.#handle.close();
    });
    return this.#closed;
  }
}
