import type { Logger } from "pino";
import type { Database } from "../db/database";
import type { WorkerLoop } from "../worker/workerLoop";
import type { ProcessingConfig } from "./processingConfig";
import { enqueueWindow } from "./processingQueue";

/** An upload's new points widen into this much on each side (docs/architecture.md §17.4). */
const ingestMarginMs = 30 * 60_000;

/**
 * Location processing as the API sees it: queue work after an upload and, in
 * role `all`, run the worker in this process and stop it. In role `api` it
 * only queues — a worker process (`trail worker`) takes the work from the
 * table (docs/architecture.md §3). With PROCESSING_ENABLED=false nothing is
 * queued or run, and the derived tables simply stay as they are.
 */
export class ProcessingService {
  readonly enabled: boolean;
  readonly config: ProcessingConfig;
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #worker: WorkerLoop | null;

  constructor(input: {
    db: Database;
    logger: Logger;
    config: ProcessingConfig;
    enabled: boolean;
    /** The worker of this process (role `all`); null when another process works the queue out. */
    worker: WorkerLoop | null;
  }) {
    this.enabled = input.enabled;
    this.config = input.config;
    this.#db = input.db;
    this.#logger = input.logger;
    this.#worker = input.worker;
  }

  /** Whether this process works the queue out itself (role `all`). */
  get runsWorker(): boolean {
    return this.#worker !== null;
  }

  start(): void {
    this.#worker?.start().catch((error: unknown) => {
      this.#logger.error({ err: error }, "processing could not start");
    });
  }

  /** Something was queued: the worker of this process runs soon (a worker process finds it itself). */
  notify(): void {
    this.#worker?.notify();
  }

  /** Queues the window of an upload's new points (after its commit) and wakes the worker. */
  async afterIngest(deviceId: string, first: Date, last: Date): Promise<void> {
    if (!this.enabled) return;
    await enqueueWindow(this.#db, {
      deviceId,
      from: new Date(first.getTime() - ingestMarginMs),
      to: new Date(last.getTime() + ingestMarginMs),
      reason: "ingest",
    });
    this.notify();
  }

  /** Runs everything that is ready, map tiles included (tests); nothing without a worker here. */
  async flush(): Promise<void> {
    await this.#worker?.flush();
  }

  async stop(): Promise<void> {
    await this.#worker?.stop();
    this.#logger.debug("processing stopped");
  }
}
