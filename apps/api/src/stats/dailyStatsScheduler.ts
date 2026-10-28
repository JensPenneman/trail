import type { ServerEvent } from "@trail/contracts/events";
import { eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { loadStampedDays } from "../cache/dayStamps";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import type { EventBus } from "../events/eventBus";
import { recomputeDailyStats } from "./recomputeDailyStats";

/** Per device, its days — true for one whose statistics are summed up again, false to announce only. */
type Batch = Map<string, Map<string, boolean>>;

/**
 * Debounced daily-stats refresh: uploads mark (device, day) pairs dirty and a
 * single pass recomputes them a few seconds later, so a phone sending every
 * minute does not rescan its whole day each time. After a pass the owner's
 * open streams get a `days` event per device with the days' rows and stamps
 * (docs/architecture.md §9), also for days whose stamps changed without their
 * points (`announce`). Failures are logged; the pairs of a failed pass are
 * retried with the next one.
 */
export class DailyStatsScheduler {
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #bus: EventBus | null;
  readonly #delayMs: number;
  #pending: Batch = new Map();
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | null = null;
  #stopped = false;

  constructor(db: Database, logger: Logger, bus: EventBus | null, delayMs = 10_000) {
    this.#db = db;
    this.#logger = logger;
    this.#bus = bus;
    this.#delayMs = delayMs;
  }

  /** Days whose points changed: summed up again with the next pass, then announced. */
  schedule(deviceId: string, dates: readonly string[]): void {
    this.#add(deviceId, dates, true);
  }

  /**
   * Days whose stamps changed but not their points — a visit or a trip
   * stored, a deletion that summed them up itself: announced with the next
   * pass without being summed up again.
   */
  announce(deviceId: string, dates: readonly string[]): void {
    this.#add(deviceId, dates, false);
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

  #add(deviceId: string, dates: readonly string[], recompute: boolean): void {
    if (this.#stopped || dates.length === 0) return;
    let days = this.#pending.get(deviceId);
    if (days === undefined) {
      days = new Map();
      this.#pending.set(deviceId, days);
    }
    for (const date of dates) days.set(date, recompute || days.get(date) === true);
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.#run();
      }, this.#delayMs);
      this.#timer.unref();
    }
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

  async #recompute(batch: Batch): Promise<void> {
    try {
      // The owner's time zone at run time: a change meanwhile triggers a full rebuild anyway.
      const owners = await this.#db
        .select({ id: devices.id, userId: devices.userId, timezone: users.timezone })
        .from(devices)
        .innerJoin(users, eq(users.id, devices.userId))
        .where(inArray(devices.id, [...batch.keys()]));
      for (const owner of owners) {
        const days = batch.get(owner.id) ?? new Map<string, boolean>();
        const dirty = [...days].flatMap(([date, recompute]) => (recompute ? [date] : []));
        await recomputeDailyStats(this.#db, owner.id, owner.timezone, dirty.sort());
        await this.#announceDays(owner, [...days.keys()].sort());
      }
    } catch (error) {
      this.#logger.error({ err: error }, "daily statistics refresh failed");
      if (!this.#stopped) {
        for (const [deviceId, days] of batch) {
          for (const [date, recompute] of days) this.#add(deviceId, [date], recompute);
        }
      }
    }
  }

  /**
   * The `days` event: the dates and the rows they have now, each with its
   * stamp, to the owner's streams only — never to the people the device is
   * shared with. Skipped while the owner has no stream to tell.
   */
  async #announceDays(
    owner: { id: string; userId: string; timezone: string },
    dates: readonly string[],
  ): Promise<void> {
    const bus = this.#bus;
    if (bus === null || !bus.follows(owner.userId) || dates.length === 0) return;
    const stamped = await loadStampedDays(this.#db, {
      deviceIds: [owner.id],
      timezone: owner.timezone,
      dates,
    });
    const event: ServerEvent = {
      type: "days",
      deviceId: owner.id,
      dates: [...dates],
      days: stamped.flatMap((day) =>
        day.stat === null ? [] : [{ ...day.stat, stamp: day.stamp }],
      ),
    };
    bus.publish(owner.userId, event);
  }
}
