import type { FileHandle } from "node:fs/promises";
import type { RangeResponse, Source } from "pmtiles";

/** No directory of a Trail build comes near this; a read this large is a broken archive. */
const maxReadBytes = 32 * 1024 * 1024;
/** The `pmtiles` package reads the header and the root directory in one read of this size. */
const headerProbeBytes = 16_384;

/** A read the archive cannot answer: outside the file, too large, or cut short. */
export class ArchiveReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveReadError";
  }
}

/**
 * A PMTiles archive on the map data volume as the `pmtiles` package reads it
 * (docs/design/self-hosted-maps.md §3.3, §7): byte ranges of a file handle
 * opened once, each checked before it is read — whole numbers, inside the
 * file, at most 32 MiB — so that offsets from a damaged directory never read
 * past the archive or allocate without bound. Only the first read, the
 * header with the root directory, may come back shorter than asked, for an
 * archive smaller than the 16 KiB it asks for.
 */
export class ArchiveFileSource implements Source {
  readonly #handle: FileHandle;
  readonly #size: number;
  readonly #key: string;

  constructor(handle: FileHandle, size: number, key: string) {
    this.#handle = handle;
    this.#size = size;
    this.#key = key;
  }

  /** The cache key of the archive: its build's digest, unique on the volume. */
  getKey(): string {
    return this.#key;
  }

  get size(): number {
    return this.#size;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > maxReadBytes
    ) {
      throw new ArchiveReadError(`refused a read of ${length} bytes at ${offset}`);
    }
    let wanted = length;
    if (offset + length > this.#size) {
      if (offset !== 0 || length !== headerProbeBytes) {
        throw new ArchiveReadError(
          `a read of ${length} bytes at ${offset} passes the end of the archive (${this.#size} bytes)`,
        );
      }
      wanted = this.#size;
    }
    const data = new Uint8Array(wanted);
    let done = 0;
    while (done < wanted) {
      const { bytesRead } = await this.#handle.read(data, done, wanted - done, offset + done);
      if (bytesRead === 0) throw new ArchiveReadError("the archive ended before its stated size");
      done += bytesRead;
    }
    return { data: data.buffer };
  }
}
