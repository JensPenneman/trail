import { once } from "node:events";
import { finished } from "node:stream/promises";
import type { PoolClient } from "pg";
import { type CopyStreamQuery, from as copyFrom } from "pg-copy-streams";

/** About what Postgres takes in one CopyData message. */
const chunkChars = 1 << 16;

/**
 * One `COPY … FROM STDIN` for a whole table, fed rows in COPY's text format
 * and written in chunks with backpressure, so that nothing piles up in
 * memory. One COPY a table, not one a batch: into a table created in the same
 * transaction Postgres bypasses the free space map, and the pages each COPY
 * reserves beyond its last row would stay empty (a third of `osm_tile_ways`,
 * measured on Belgium).
 */
export class CopyStream {
  readonly #stream: CopyStreamQuery;
  readonly #done: Promise<void>;
  #rows: string[] = [];
  #chars = 0;

  constructor(client: PoolClient, statement: string) {
    this.#stream = client.query(copyFrom(statement));
    this.#done = finished(this.#stream);
    // Awaited by `end`; an error before then must not count as unhandled.
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
    if (this.#rows.length === 0) return;
    const text = this.#rows.join("");
    this.#rows = [];
    this.#chars = 0;
    if (!this.#stream.write(text)) await once(this.#stream, "drain");
  }

  /** Writes the rest and waits until Postgres has every row. */
  async end(): Promise<void> {
    await this.flush();
    this.#stream.end();
    await this.#done;
  }

  /** Abandons the COPY: Postgres gets a CopyFail and the transaction is aborted. */
  abort(error: Error): void {
    this.#stream.destroy(error);
  }
}
