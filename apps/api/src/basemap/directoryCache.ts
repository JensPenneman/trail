import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  type Cache,
  Compression,
  type Entry,
  type Header,
  ResolvedValueCache,
  type Source,
} from "pmtiles";

const gunzipAsync = promisify(gunzip);

/** A directory larger than this once inflated is not one Planetiler wrote. */
const maxInflatedBytes = 32 * 1024 * 1024;
/** What an entry takes in memory, roughly: its object of four numbers and its slot. */
const entryBytes = 72;
/** A header, with the strings of its key. */
const headerBytes = 1024;

/** Directories are gzipped or stored (the archive's `internalCompression`, checked on open). */
async function decompress(buffer: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  if (compression === Compression.None) return buffer;
  if (compression !== Compression.Gzip) {
    throw new Error(`directories compressed with ${Compression[compression]} are not supported`);
  }
  const inflated = await gunzipAsync(new Uint8Array(buffer), {
    maxOutputLength: maxInflatedBytes,
  });
  return new Uint8Array(inflated).buffer;
}

interface Cached {
  value: Header | Entry[];
  bytes: number;
}

/**
 * The headers and directories of the open archives (docs/design/self-hosted-maps.md
 * §3.3): parsed and checked by the `pmtiles` package, kept here in one
 * least-recently-used map bounded by an estimate of their memory (about
 * 10 MB), whatever the number or the size of the archives. A tile read
 * looks up the root directory, and for a large archive one leaf, so the
 * directories of the parts of the map people look at stay in memory and the
 * rest is read again from the page cache when needed. Concurrent misses of
 * the same directory share one read.
 */
export class DirectoryCache implements Cache {
  /** Parses; keeps next to nothing itself. */
  readonly #parser = new ResolvedValueCache(4, true, decompress);
  readonly #entries = new Map<string, Cached>();
  readonly #pending = new Map<string, Promise<Header | Entry[]>>();
  readonly #maxBytes: number;
  #bytes = 0;

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes;
  }

  /** The memory the cache holds by its estimate. */
  get bytes(): number {
    return this.#bytes;
  }

  getHeader(source: Source): Promise<Header> {
    return this.#get(
      `${source.getKey()}|header`,
      () => this.#parser.getHeader(source),
      () => headerBytes,
    ) as Promise<Header>;
  }

  getDirectory(
    source: Source,
    offset: number,
    length: number,
    header: Header,
    signal?: AbortSignal,
  ): Promise<Entry[]> {
    return this.#get(
      `${source.getKey()}|${offset}|${length}`,
      () => this.#parser.getDirectory(source, offset, length, header, signal),
      (value) => (Array.isArray(value) ? value.length * entryBytes : headerBytes),
    ) as Promise<Entry[]>;
  }

  async invalidate(source: Source): Promise<void> {
    this.forget(source.getKey());
    await this.#parser.invalidate(source);
  }

  /** Drops everything of one archive (it was closed). */
  forget(key: string): void {
    const prefix = `${key}|`;
    for (const [name, cached] of this.#entries) {
      if (!name.startsWith(prefix)) continue;
      this.#entries.delete(name);
      this.#bytes -= cached.bytes;
    }
  }

  async #get(
    key: string,
    load: () => Promise<Header | Entry[]>,
    size: (value: Header | Entry[]) => number,
  ): Promise<Header | Entry[]> {
    const cached = this.#entries.get(key);
    if (cached !== undefined) {
      // Most recently used last: a Map iterates in insertion order.
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached.value;
    }
    const pending = this.#pending.get(key);
    if (pending !== undefined) return pending;
    const loading = load().finally(() => this.#pending.delete(key));
    this.#pending.set(key, loading);
    const value = await loading;
    const bytes = size(value);
    if (bytes <= this.#maxBytes && !this.#entries.has(key)) {
      this.#entries.set(key, { value, bytes });
      this.#bytes += bytes;
      for (const [name, entry] of this.#entries) {
        if (this.#bytes <= this.#maxBytes) break;
        this.#entries.delete(name);
        this.#bytes -= entry.bytes;
      }
    }
    return value;
  }
}
