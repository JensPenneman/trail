import { eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import { lockDeviceProcessing } from "../processing/deviceLock";
import { rebuildHeatDays } from "./rebuildHeatDays";

/**
 * Debounced rebuild of the per-day heat cells after processing (docs/architecture.md §8.2): a
 * pass marks the (device, local day) pairs it touched once it has committed, and one run a few
 * seconds later rebuilds them, each device in a transaction of its own under its processing lock,
 * so that a phone sending every minute does not rebuild its whole day each time and an error
 * here never rolls back, retries or stalls a pass. Failures are logged; the days of a failed run
 * are dropped (the features backfill finds days that have no cells at all at the next start).
 */
export class HeatDaysScheduler {
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #delayMs: number;
  #pending = new Map<string, Set<string>>();
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | null = null;
  #stopped = false;

  constructor(db: Database, logger: Logger, delayMs = 15_000) {
    this.#db = db;
    this.#logger = logger;
    this.#delayMs = delayMs;
  }

  /** Days of a device whose points or segments changed. */
  schedule(deviceId: string, days: readonly string[]): void {
    if (this.#stopped || days.length === 0) return;
    const set = this.#pending.get(deviceId) ?? new Set<string>();
    for (const day of days) set.add(day);
    this.#pending.set(deviceId, set);
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.#run();
      }, this.#delayMs);
      this.#timer.unref();
    }
  }

  /** (device, day) pairs waiting for their rebuild. */
  pendingDays(): number {
    let total = 0;
    for (const days of this.#pending.values()) total += days.size;
    return total;
  }

  /** Rebuilds everything pending now and waits for it (tests, shutdown). */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
    await this.#run();
  }

  /** Stops accepting work; call `flush` first to finish what is pending. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #run(): Promise<void> {
    if (this.#running !== null) {
      await this.#running;
      if (this.#pending.size === 0) return;
    }
    const batch = this.#pending;
    this.#pending = new Map();
    if (batch.size === 0) return;
    this.#running = this.#rebuild(batch).finally(() => {
      this.#running = null;
    });
    await this.#running;
  }

  async #rebuild(batch: Map<string, Set<string>>): Promise<void> {
    let owners: { id: string; timezone: string }[];
    try {
      // The owner's zone at run time: a change meanwhile rebuilds every day anyway.
      owners = await this.#db
        .select({ id: devices.id, timezone: users.timezone })
        .from(devices)
        .innerJoin(users, eq(users.id, devices.userId))
        .where(inArray(devices.id, [...batch.keys()]));
    } catch (error) {
      this.#logger.error({ err: error }, "heat days could not be scheduled");
      return;
    }
    for (const owner of owners) {
      const days = [...(batch.get(owner.id) ?? [])].sort();
      const started = performance.now();
      try {
        await this.#db.transaction(async (tx) => {
          await lockDeviceProcessing(tx, owner.id);
          await rebuildHeatDays(tx, owner.id, owner.timezone, days);
        });
        this.#logger.debug(
          {
            deviceId: owner.id,
            days: days.length,
            heatDaysMs: Math.round(performance.now() - started),
          },
          "heat days rebuilt",
        );
      } catch (error) {
        this.#logger.error(
          { err: error, deviceId: owner.id, days },
          "heat days could not be rebuilt",
        );
      }
    }
  }
}
