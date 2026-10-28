import { once } from "node:events";
import { finished } from "node:stream/promises";
import type { PoolClient } from "pg";
import { type CopyStreamQuery, from as copyFrom } from "pg-copy-streams";

/** About what Postgres takes in one CopyData message. */
const chunkChars = 1 << 16;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * One `COPY … FROM STDIN` for a whole table, fed rows in COPY's text format
 * and written in chunks with backpressure, so that nothing piles up in
 * memory. One COPY a table, not one a batch: into a table created in the same
 * transaction Postgres bypasses the free space map, and the pages each COPY
 * reserves beyond its last row would stay empty (a third of `osm_tile_ways`,
 * measured on Belgium).
 *
 * When Postgres refuses the COPY halfway (a full disk, a row a constraint
 * rejects), pg-copy-streams emits the error and lets go of the connection
 * without ending the stream: the error is kept as it comes and is what
 * `flush` and `end` throw from then on, Postgres' own words, instead of what
 * writing to the released connection would throw.
 */
export class CopyStream {
  readonly #stream: CopyStreamQuery;
  readonly #done: Promise<void>;
  #error: Error | null = null;
  #rows: string[] = [];
  #chars = 0;

  constructor(client: PoolClient, statement: string) {
    this.#stream = client.query(copyFrom(statement));
    this.#stream.on("error", (error: unknown) => {
      this.#error ??= asError(error);
    });
    this.#done = finished(this.#stream);
    // Awaited by `end`; the error itself is kept above.
    this.#done.catch(() => undefined);
  }

  /** Takes a row; true when the caller should `flush` before the next. */
  add(row: string): boolean {
    this.#rows.push(row);
    this.#chars += row.length;
    return this.#chars >= chunkChars;
  }

  /** Writes the rows taken so far, waiting while Postgres is behind. */
  async flush(): Promise<void> {
    if (this.#error !== null) throw this.#error;
    if (this.#rows.length === 0) return;
    const text = this.#rows.join("");
    this.#rows = [];
    this.#chars = 0;
    // An error while waiting rejects the wait with it (events.once), never a drain that cannot come.
    if (!this.#stream.write(text)) await once(this.#stream, "drain");
  }

  /** Writes the rest and waits until Postgres has every row. */
  async end(): Promise<void> {
    await this.flush();
    this.#stream.end();
    try {
      await this.#done;
    } catch (error) {
      throw this.#error ?? asError(error);
    }
  }

  /**
   * Abandons the COPY: Postgres gets a CopyFail and the transaction is
   * aborted. Nothing to do once Postgres has refused it: it has aborted the
   * COPY itself and the stream has no connection left to send on.
   */
  abort(error: Error): void {
    if (this.#error !== null) return;
    this.#stream.destroy(error);
  }
}
