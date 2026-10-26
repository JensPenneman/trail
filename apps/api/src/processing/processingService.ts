import type { Logger } from "pino";
import type { Database } from "../db/database";
import type { EventBus } from "../events/eventBus";
import type { ProcessingConfig } from "./processingConfig";
import { enqueueWindow } from "./processingQueue";
import { ProcessingWorker } from "./processingWorker";
import { TileFetcher } from "./tileFetcher";
import type { WaySource } from "./waySource";

/** An upload's new points widen into this much on each side (docs/architecture.md §17.4). */
const ingestMarginMs = 30 * 60_000;

/**
 * Location processing as the rest of the app sees it: queue work after an
 * upload, run the worker, stop it. With PROCESSING_ENABLED=false nothing is
 * queued or run, and the derived tables simply stay as they are.
 */
export class ProcessingService {
  readonly enabled: boolean;
  /** False when no map data source is configured: the mapped level degrades to averaged. */
  readonly mapping: boolean;
  readonly config: ProcessingConfig;
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #worker: ProcessingWorker | null;

  constructor(input: {
    db: Database;
    logger: Logger;
    bus: EventBus;
    config: ProcessingConfig;
    enabled: boolean;
    waySource: WaySource | null;
    dailyBytes: number;
    delayMs?: number;
  }) {
    this.enabled = input.enabled;
    this.mapping = input.enabled && input.waySource !== null;
    this.config = input.config;
    this.#db = input.db;
    this.#logger = input.logger;
    this.#worker = input.enabled
      ? new ProcessingWorker({
          db: input.db,
          logger: input.logger,
          bus: input.bus,
          config: input.config,
          fetcher:
            input.waySource === null
              ? null
              : new TileFetcher({
                  db: input.db,
                  logger: input.logger,
                  source: input.waySource,
                  dailyBytes: input.dailyBytes,
                  maxAgeDays: input.config.mapping.tileMaxAgeDays,
                }),
          ...(input.delayMs === undefined ? {} : { delayMs: input.delayMs }),
        })
      : null;
  }

  start(): void {
    this.#worker?.start();
  }

  /** Something was queued: the worker runs soon. */
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

  /** Runs everything that is ready, map tiles included (tests and the CLI). */
  async flush(): Promise<void> {
    await this.#worker?.flush();
  }

  async stop(): Promise<void> {
    await this.#worker?.stop();
    this.#logger.debug("processing stopped");
  }
}
