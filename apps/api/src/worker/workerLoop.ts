import type { Logger } from "pino";
import type { Database } from "../db/database";
import { windowReady } from "../processing/processingQueue";
import type { ProcessingWorker } from "../processing/processingWorker";
import { workerId, writeHeartbeat } from "./workerHeartbeats";

/** A worker refreshes its heartbeat this often (docs/architecture.md §17.4). */
const heartbeatMs = 15_000;
/** A worker process looks for ready windows this often while it has none: no upload wakes it. */
const readyPollMs = 2_000;

/**
 * A worker (docs/architecture.md §3): the processing worker — the passes, the
 * map tiles, the backfill at the start and the 15-minute pass — and the
 * heartbeat that tells the API it is there. In a worker process only the
 * queue tells it of new work, so it looks for ready windows every two
 * seconds; in the API's process (role `all`) an upload wakes it, as it always
 * did. With processing switched off it only beats. The time of its last
 * written beat is what the worker process's liveness probe asks
 * (`heartbeatAgeMs`).
 */
export class WorkerLoop {
  /** The heartbeat's id: host, process and start. */
  readonly id: string;
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #processing: ProcessingWorker | null;
  readonly #version: string;
  readonly #pollReady: boolean;
  readonly #stall: boolean;
  readonly #startedAt = new Date();
  /** When the last heartbeat was written, on the monotonic clock; null before the first. */
  #lastBeatAt: number | null = null;
  #stalled = false;
  #heartbeat: NodeJS.Timeout | undefined;
  #poll: NodeJS.Timeout | undefined;
  #polling = false;
  #started = false;
  #stopping: Promise<void> | null = null;

  constructor(input: {
    db: Database;
    logger: Logger;
    /** Null with processing switched off. */
    processing: ProcessingWorker | null;
    /** The release, for the heartbeat. */
    version: string;
    /** Look for ready windows: in a process that no upload wakes. */
    pollReady: boolean;
    /** PROCESSING_TEST_STALL: beat once, then stand still (tests of the health check). */
    stall?: boolean;
  }) {
    this.#db = input.db;
    this.#logger = input.logger;
    this.#processing = input.processing;
    this.#version = input.version;
    this.#pollReady = input.pollReady;
    this.#stall = input.stall === true;
    this.id = workerId(this.#startedAt);
  }

  /** Writes the first heartbeat, then starts the timers (the server and the worker; tests use `flush`). */
  async start(): Promise<void> {
    if (this.#started || this.#stopping !== null) return;
    this.#started = true;
    await this.#beat();
    if (this.#stopping !== null) return;
    if (this.#stall) {
      // A loop that hangs right after its start: no beat, no pass from now on.
      this.#stalled = true;
      this.#logger.warn(
        "PROCESSING_TEST_STALL is set: the worker beat once and stands still, its health check fails in 90 s",
      );
      return;
    }
    this.#heartbeat = setInterval(() => void this.#beat(), heartbeatMs);
    this.#heartbeat.unref();
    if (this.#pollReady && this.#processing !== null) {
      this.#poll = setInterval(() => void this.#lookForWork(), readyPollMs);
      this.#poll.unref();
    }
    this.#processing?.start();
  }

  /** New work was queued in this process: run soon. */
  notify(): void {
    this.#processing?.notify();
  }

  /** Milliseconds since the last heartbeat was written; null before the first (the liveness probe). */
  heartbeatAgeMs(): number | null {
    return this.#lastBeatAt === null ? null : performance.now() - this.#lastBeatAt;
  }

  /** Processes everything ready now, map tiles included, until nothing is left (tests). */
  async flush(): Promise<void> {
    await this.#processing?.flush();
  }

  /**
   * Takes no more work, lets the pass in progress commit, stops the map
   * downloads and writes the last heartbeat (which the API then sees age).
   */
  stop(): Promise<void> {
    this.#stopping ??= (async () => {
      clearInterval(this.#heartbeat);
      clearInterval(this.#poll);
      await this.#processing?.stop();
      if (this.#started && !this.#stalled) await this.#beat();
    })();
    return this.#stopping;
  }

  async #beat(): Promise<void> {
    const totals = this.#processing?.totals ?? { passes: 0, points: 0 };
    try {
      await writeHeartbeat(this.#db, {
        id: this.id,
        startedAt: this.#startedAt,
        version: this.#version,
        jobId: null,
        ...totals,
      });
      this.#lastBeatAt = performance.now();
    } catch (error) {
      this.#logger.warn({ err: error }, "worker heartbeat could not be written");
    }
  }

  async #lookForWork(): Promise<void> {
    const processing = this.#processing;
    if (processing === null || processing.busy || this.#polling || this.#stopping !== null) return;
    this.#polling = true;
    try {
      if (await windowReady(this.#db, new Date())) processing.notify(0);
    } catch (error) {
      // A database that is gone shows in the heartbeat's warning; this one would repeat every 2 s.
      this.#logger.debug({ err: error }, "processing queue could not be looked at");
    } finally {
      this.#polling = false;
    }
  }
}
