import type { Database } from "../../src/db/database";
import type { ProcessingConfig } from "../../src/processing/processingConfig";
import {
  livePassIntervalMs,
  type QueueRow,
  queuePriority,
  takeNextWindow,
} from "../../src/processing/processingQueue";
import { processWindow, type WindowOutcome } from "../../src/processing/processWindow";

/** One pass: the queue rows it took, what it worked out and how long it took. */
export interface Pass {
  rows: readonly QueueRow[];
  outcome: WindowOutcome;
  ms: number;
}

/**
 * Runs passes as the worker does (`ProcessingWorker`) — the next window, the
 * others' turn after a pass of new data, an upload not waiting for its
 * pass interval (as in a flush) — one at a time, keeping the pass log and
 * calling `after` once each pass has committed, so that a test can check
 * the invariants between passes. Map tiles are not fetched: a window whose
 * tiles are missing waits.
 */
export class PassRunner {
  readonly log: Pass[] = [];
  readonly #db: Database;
  readonly #config: ProcessingConfig;
  readonly #mapping: boolean;
  readonly #after: (pass: Pass) => Promise<void>;
  #lastPriority: number | null = null;

  constructor(input: {
    db: Database;
    config: ProcessingConfig;
    mapping: boolean;
    after?: (pass: Pass) => Promise<void>;
  }) {
    this.#db = input.db;
    this.#config = input.config;
    this.#mapping = input.mapping;
    this.#after = input.after ?? (async () => {});
  }

  /** Runs the next pass; null when nothing is ready, or `when` declines the rows it would take. */
  async next(when: (rows: readonly QueueRow[]) => boolean = () => true): Promise<Pass | null> {
    const now = new Date();
    const rows = await takeNextWindow(this.#db, now, {
      othersFirst: this.#lastPriority === queuePriority.live,
      liveReadyBy: new Date(now.getTime() + livePassIntervalMs),
    });
    if (rows.length === 0 || !when(rows)) return null;
    this.#lastPriority = Math.min(...rows.map((row) => row.priority));
    const started = performance.now();
    const outcome = await processWindow(this.#db, rows, {
      config: this.#config,
      mapping: this.#mapping,
      now: new Date(),
    });
    if (outcome === null) throw new Error("The device of a queued window is gone");
    const pass = { rows, outcome, ms: performance.now() - started };
    this.log.push(pass);
    await this.#after(pass);
    return pass;
  }

  /** Runs passes until nothing is ready; at most `limit` of them. */
  async drain(limit = 500): Promise<Pass[]> {
    const passes: Pass[] = [];
    while (passes.length < limit) {
      const pass = await this.next();
      if (pass === null) return passes;
      passes.push(pass);
    }
    throw new Error(`Still work queued after ${limit} passes`);
  }
}
