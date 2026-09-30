import { eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import { recomputeDailyStats } from "./recomputeDailyStats";

/**
 * Debounced daily-stats refresh: uploads mark (device, day) pairs dirty and a
 * single pass recomputes them a few seconds later, so a phone sending every
 * minute does not rescan its whole day each time. Failures are logged; the
 * pairs of a failed pass are retried with the next one.
 */
export class DailyStatsScheduler {
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #delayMs: number;
  #pending = new Map<string, Set<string>>();
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | null = null;
  #stopped = false;

  constructor(db: Database, logger: Logger, delayMs = 10_000) {
    this.#db = db;
    this.#logger = logger;
    this.#delayMs = delayMs;
  }

  schedule(deviceId: string, dates: readonly string[]): void {
    if (this.#stopped || dates.length === 0) return;
    let days = this.#pending.get(deviceId);
    if (days === undefined) {
      days = new Set();
      this.#pending.set(deviceId, days);
    }
    for (const date of dates) days.add(date);
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.#run();
      }, this.#delayMs);
      this.#timer.unref();
    }
  }

  /** Recomputes everything pending now and waits for it (tests, shutdown). */
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
    this.#running = this.#recompute(batch).finally(() => {
      this.#running = null;
    });
    await this.#running;
  }

  async #recompute(batch: Map<string, Set<string>>): Promise<void> {
    try {
      // The owner's time zone at run time: a change meanwhile triggers a full rebuild anyway.
      const owners = await this.#db
        .select({ id: devices.id, timezone: users.timezone })
        .from(devices)
        .innerJoin(users, eq(users.id, devices.userId))
        .where(inArray(devices.id, [...batch.keys()]));
      for (const owner of owners) {
        const dates = [...(batch.get(owner.id) ?? [])].sort();
        await recomputeDailyStats(this.#db, owner.id, owner.timezone, dates);
      }
    } catch (error) {
      this.#logger.error({ err: error }, "daily statistics refresh failed");
      if (!this.#stopped) {
        for (const [deviceId, dates] of batch) this.schedule(deviceId, [...dates]);
      }
    }
  }
}
