import { setImmediate as yieldToEvents } from "node:timers/promises";
import type { Logger } from "pino";
import type { Database } from "../db/database";
import type { EventBus } from "../events/eventBus";
import { enqueueBackfill, enqueueCatchUp } from "./backfill";
import type { ProcessingConfig } from "./processingConfig";
import { rearmWindows, retryWindows, takeNextWindow } from "./processingQueue";
import { processingVersions } from "./processingVersion";
import { processWindow } from "./processWindow";
import type { TileFetcher } from "./tileFetcher";
import { staleBefore } from "./tileStore";

/** After an upload the worker waits this long, so a burst of uploads becomes one pass. */
const defaultDelayMs = 3000;
/** Retries and windows that waited for map data come due; the worker looks this often. */
const pollMs = 60_000;
/** The pass for windows waiting on map data, and the catch-up safety net. */
const mapPassMs = 15 * 60_000;

/**
 * The one in-process processing worker (docs/architecture.md §17.4), in the
 * pattern of the daily-statistics scheduler but reading its work from the
 * `processing_queue` table: new data first, the backfill newest day first, one
 * window at a time, giving the event loop a turn between windows. Map tiles
 * are fetched alongside, so a missing tile never holds up other windows.
 * Failures are logged and retried with backoff; nothing throws out of it.
 */
export class ProcessingWorker {
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #bus: EventBus;
  readonly #config: ProcessingConfig;
  readonly #fetcher: TileFetcher | null;
  readonly #delayMs: number;
  readonly #abort = new AbortController();
  #timer: NodeJS.Timeout | undefined;
  #poll: NodeJS.Timeout | undefined;
  #mapPass: NodeJS.Timeout | undefined;
  #running: Promise<void> | null = null;
  #again = false;
  #fetching: Promise<void> | null = null;
  #started = false;
  #stopped = false;

  constructor(input: {
    db: Database;
    logger: Logger;
    bus: EventBus;
    config: ProcessingConfig;
    fetcher: TileFetcher | null;
    delayMs?: number;
  }) {
    this.#db = input.db;
    this.#logger = input.logger;
    this.#bus = input.bus;
    this.#config = input.config;
    this.#fetcher = input.fetcher;
    this.#delayMs = input.delayMs ?? defaultDelayMs;
  }

  /** Starts the timers and the boot-time backfill (the server; tests use `flush`). */
  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    this.#poll = setInterval(() => this.notify(0), pollMs);
    this.#poll.unref();
    this.#mapPass = setInterval(() => void this.#mapWaitPass(), mapPassMs);
    this.#mapPass.unref();
    void this.#backfill().then(() => this.notify(0));
  }

  /** New work was queued: run soon. */
  notify(delayMs = this.#delayMs): void {
    if (this.#stopped) return;
    if (this.#running !== null) {
      this.#again = true;
      return;
    }
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run();
    }, delayMs);
    this.#timer.unref();
  }

  /** Processes everything ready now, fetching map tiles as needed, until nothing is left (tests, CLI). */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    for (let round = 0; round < 20; round += 1) {
      await this.#running;
      await this.#fetching;
      const processed = await this.#processReady();
      const fetched = await this.#fetchTiles();
      if (processed === 0 && fetched === 0) return;
    }
  }

  /** Stops taking work; a window in progress finishes (its transaction is short). */
  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    clearInterval(this.#poll);
    clearInterval(this.#mapPass);
    this.#abort.abort();
    await Promise.allSettled([this.#running, this.#fetching]);
  }

  async #run(): Promise<void> {
    if (this.#running !== null) {
      this.#again = true;
      return;
    }
    this.#running = (async () => {
      do {
        this.#again = false;
        await this.#processReady();
      } while (this.#again && !this.#stopped);
    })().finally(() => {
      this.#running = null;
    });
    await this.#running;
    this.#startFetching();
  }

  /** Processes ready windows one by one; returns how many passes ran. */
  async #processReady(): Promise<number> {
    let passes = 0;
    while (!this.#stopped) {
      const rows = await takeNextWindow(this.#db, new Date()).catch((error: unknown) => {
        this.#logger.error({ err: error }, "processing queue could not be read");
        return [];
      });
      if (rows.length === 0) break;
      passes += 1;
      const started = performance.now();
      try {
        const outcome = await processWindow(this.#db, rows, {
          config: this.#config,
          mapping: this.#fetcher !== null,
          now: new Date(),
        });
        if (outcome !== null) {
          this.#logger.info(
            {
              deviceId: outcome.deviceId,
              from: outcome.from.toISOString(),
              to: outcome.to.toISOString(),
              points: outcome.points,
              segments: outcome.segments,
              missingTiles: outcome.missingTiles.length,
              reason: rows[0]?.reason,
              ms: Math.round(performance.now() - started),
            },
            "processing window done",
          );
          this.#bus.publish(outcome.userId, {
            type: "segments",
            deviceId: outcome.deviceId,
            from: outcome.from.toISOString(),
            to: outcome.to.toISOString(),
          });
          // Tiles are fetched alongside: a long backfill does not keep the map waiting.
          if (outcome.missingTiles.length > 0) this.#startFetching();
        }
      } catch (error) {
        this.#logger.error({ err: error, deviceId: rows[0]?.deviceId }, "processing window failed");
        await retryWindows(
          this.#db,
          rows,
          error instanceof Error ? error.message : String(error),
        ).catch((retryError: unknown) => {
          this.#logger.error({ err: retryError }, "processing retry could not be scheduled");
        });
      }
      // Requests waiting on the event loop go first.
      await yieldToEvents();
    }
    return passes;
  }

  #startFetching(): void {
    if (this.#fetcher === null || this.#fetching !== null || this.#stopped) return;
    this.#fetching = this.#fetchTiles()
      .then((fetched) => {
        if (fetched > 0) this.notify(0);
      })
      .finally(() => {
        this.#fetching = null;
      });
  }

  async #fetchTiles(): Promise<number> {
    if (this.#fetcher === null) return 0;
    try {
      const round = await this.#fetcher.fetchWaiting(this.#abort.signal);
      return round.fetched;
    } catch (error) {
      this.#logger.error({ err: error }, "map tiles could not be fetched");
      return 0;
    }
  }

  async #mapWaitPass(): Promise<void> {
    try {
      const rearmed = await rearmWindows(
        this.#db,
        staleBefore(this.#config.mapping.tileMaxAgeDays, new Date()),
      );
      const caughtUp = await enqueueCatchUp(this.#db);
      if (rearmed + caughtUp > 0) this.notify(0);
      this.#startFetching();
    } catch (error) {
      this.#logger.error({ err: error }, "processing map pass failed");
    }
  }

  async #backfill(): Promise<void> {
    try {
      const { days, fromLevel } = await enqueueBackfill(this.#db, processingVersions);
      if (days > 0) {
        // How much is redone: everything, from map matching on, or only the inference.
        this.#logger.info(
          { days, fromLevel, versions: processingVersions },
          "processing backfill queued",
        );
      }
    } catch (error) {
      this.#logger.error({ err: error }, "processing backfill could not be queued");
    }
  }
}
