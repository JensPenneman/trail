import type { Logger } from "pino";
import type { Database } from "../db/database";
import { rearmWindows, tilesToFetch } from "./processingQueue";
import { parseTileKey } from "./tileCover";
import { bytesFetchedToday, recordTileFailure, saveTile, staleBefore } from "./tileStore";
import { TileFetchError, type WaySource } from "./waySource";

export interface FetchRound {
  fetched: number;
  failed: number;
  /** The daily budget ran out before everything was fetched. */
  overBudget: boolean;
}

/**
 * Fetches the map tiles that waiting windows need (docs/architecture.md
 * §17.3), one at a time through the way source, within the daily download
 * budget — tiles not cached yet, and those older than the configured age —
 * and makes a window ready again as soon as its tiles are all there.
 * A tile that fails is tried again later (the tile store's backoff).
 */
export class TileFetcher {
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #source: WaySource;
  readonly #dailyBytes: number;
  readonly #maxAgeDays: number;

  constructor(input: {
    db: Database;
    logger: Logger;
    source: WaySource;
    dailyBytes: number;
    /** Older tiles are fetched again (`mapping.tileMaxAgeDays`). */
    maxAgeDays: number;
  }) {
    this.#db = input.db;
    this.#logger = input.logger;
    this.#source = input.source;
    this.#dailyBytes = input.dailyBytes;
    this.#maxAgeDays = input.maxAgeDays;
  }

  /** Fetches until nothing is waiting, the budget is spent or `signal` aborts. */
  async fetchWaiting(signal: AbortSignal, now: () => Date = () => new Date()): Promise<FetchRound> {
    const round: FetchRound = { fetched: 0, failed: 0, overBudget: false };
    while (!signal.aborted) {
      if ((await bytesFetchedToday(this.#db, now())) >= this.#dailyBytes) {
        round.overBudget = true;
        this.#logger.warn(
          { dailyBytes: this.#dailyBytes },
          "daily map download budget spent; map matching resumes tomorrow",
        );
        break;
      }
      const [key] = await tilesToFetch(this.#db, now(), staleBefore(this.#maxAgeDays, now()), 1);
      if (key === undefined) break;
      const tile = parseTileKey(key);
      if (tile === null) break;
      const started = performance.now();
      try {
        const data = await this.#source.fetchTile(tile, signal);
        await saveTile(this.#db, tile, data, now());
        round.fetched += 1;
        // Counts and times for the log; which tile only at debug: a tile is where someone was.
        this.#logger.debug({ tile: key, outcome: "stored" }, "map tile");
        this.#logger.info(
          {
            source: this.#source.name,
            ways: data.ways.length,
            stops: data.pois.length,
            bytes: data.bytes,
            ms: Math.round(performance.now() - started),
          },
          "map tile stored",
        );
        await rearmWindows(this.#db, staleBefore(this.#maxAgeDays, now()));
      } catch (error) {
        if (signal.aborted) break;
        const bytes = error instanceof TileFetchError ? error.bytes : 0;
        await recordTileFailure(this.#db, tile, bytes, now());
        round.failed += 1;
        this.#logger.debug({ tile: key, outcome: "failed", err: error }, "map tile");
        this.#logger.warn(
          error instanceof TileFetchError
            ? { reason: error.reason, ...(error.status === null ? {} : { status: error.status }) }
            : { reason: error instanceof Error ? error.name : "unknown" },
          "map tile could not be fetched; trying again later",
        );
      }
    }
    return round;
  }
}
