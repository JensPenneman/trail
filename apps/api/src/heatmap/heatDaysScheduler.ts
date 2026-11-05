import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
import { notifySegments } from "../events/processingNotify";
import { addDays } from "../lib/calendarDate";
import { startOfLocalDay } from "../lib/startOfLocalDay";
import { lockDeviceProcessing } from "../processing/deviceLock";
import { rebuildHeatDays } from "./rebuildHeatDays";

/** How far back start-up looks for days whose cells are older than their points. */
const recoverDays = 30;
const retryFirstMs = 30_000;
const retryMaxMs = 10 * 60_000;

interface MarkRow extends Record<string, unknown> {
  device_id: string;
  day: string;
  marked_at: string;
  timezone: string;
  user_id: string;
}

/**
 * Rebuilds the per-day heat cells after processing (docs/architecture.md §8.2). A pass marks the
 * (device, local day) pairs it touched in `heat_day_marks`, in its own transaction; a run some
 * seconds after the first wake-up reads the marks, rebuilds the days of each device in a
 * transaction of its own under its processing lock, and deletes the marks it served (one made
 * again meanwhile stays). Because the marks are rows, a crash, a kill or an error loses none:
 * a failed rebuild is logged and its device tried again with a growing wait of its own (another
 * device's marks are served meanwhile), and at start `recover` marks recent
 * days whose points or segments are newer than their cells and drains what is marked. An error
 * here never rolls back, retries or stalls a pass.
 */
export class HeatDaysScheduler {
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #delayMs: number;
  readonly #retryMs: number;
  /** Devices whose last rebuild failed: how many times in a row, and when they may be tried again. */
  readonly #backoff = new Map<string, { failures: number; retryAt: number }>();
  #timer: NodeJS.Timeout | undefined;
  #timerAt = 0;
  #running: Promise<void> | null = null;
  #stopped = false;

  constructor(db: Database, logger: Logger, options: { delayMs?: number; retryMs?: number } = {}) {
    this.#db = db;
    this.#logger = logger;
    this.#delayMs = options.delayMs ?? 15_000;
    this.#retryMs = options.retryMs ?? retryFirstMs;
  }

  /** Days were marked: a run follows in a few seconds. */
  wake(): void {
    this.#arm(this.#delayMs);
  }

  /** Drains the marks now, a device in its wait included, and waits for it (tests, shutdown). */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
    await this.#run(true);
  }

  /** Stops accepting work; call `flush` first to finish what is marked. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /**
   * At start: marks the days of the last 30 whose newest processed point or segment was written
   * after their newest cells (a pass that did not get to them), then drains the marks.
   */
  async recover(): Promise<void> {
    try {
      // Device by device (a lateral subquery each): the points of one device in a time range read
      // the primary key in order, where a filter on time alone would scan every device's points.
      await this.#db.execute(sql`
        INSERT INTO heat_day_marks (device_id, day, marked_at)
        SELECT w.device_id, w.day, now()
        FROM (
          SELECT d.id AS device_id, x.day, x.newest
          FROM devices d
          JOIN users u ON u.id = d.user_id
          CROSS JOIN LATERAL (
            SELECT (p.recorded_at AT TIME ZONE u.timezone)::date AS day, max(p.processed_at) AS newest
            FROM processed_points p
            WHERE p.device_id = d.id AND p.recorded_at >= now() - ${`${recoverDays + 1} days`}::interval
            GROUP BY 1
            UNION ALL
            SELECT (s.started_at AT TIME ZONE u.timezone)::date, max(s.computed_at)
            FROM segments s
            WHERE s.device_id = d.id AND s.started_at >= now() - ${`${recoverDays + 1} days`}::interval
            GROUP BY 1
          ) x
        ) w
        WHERE w.day >= current_date - ${recoverDays}::int
        GROUP BY w.device_id, w.day
        HAVING max(w.newest) > coalesce(
          (SELECT max(h.computed_at) FROM heat_days h WHERE h.device_id = w.device_id AND h.day = w.day),
          '-infinity'::timestamptz)
        ON CONFLICT (device_id, day) DO NOTHING
      `);
    } catch (error) {
      this.#logger.error({ err: error }, "heat days could not be checked at start");
    }
    await this.flush();
  }

  /** A run in `ms`: sooner than one already armed replaces it, never later. */
  #arm(ms: number): void {
    if (this.#stopped) return;
    const at = Date.now() + ms;
    if (this.#timer !== undefined) {
      if (this.#timerAt <= at) return;
      clearTimeout(this.#timer);
    }
    this.#timerAt = at;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run(false);
    }, ms);
    this.#timer.unref();
  }

  async #run(force: boolean): Promise<void> {
    if (this.#running !== null) {
      await this.#running;
      return;
    }
    this.#running = this.#drain(force).finally(() => {
      this.#running = null;
    });
    await this.#running;
  }

  /**
   * Serves the marks of every device not waiting out a failure (`force`: all of them); a device
   * whose rebuild fails waits, twice as long each time, while the others go on.
   */
  async #drain(force: boolean): Promise<void> {
    let marks: MarkRow[];
    try {
      marks = (
        await this.#db.execute<MarkRow>(sql`
          SELECT m.device_id, m.day::text AS day, m.marked_at::text AS marked_at, u.timezone, d.user_id
          FROM heat_day_marks m JOIN devices d ON d.id = m.device_id JOIN users u ON u.id = d.user_id
          ORDER BY m.device_id, m.day
        `)
      ).rows;
    } catch (error) {
      this.#logger.error({ err: error }, "heat days could not be read");
      this.#arm(this.#retryMs);
      return;
    }
    const byDevice = new Map<string, MarkRow[]>();
    for (const mark of marks)
      byDevice.set(mark.device_id, [...(byDevice.get(mark.device_id) ?? []), mark]);
    // A device with nothing marked has nothing to wait for.
    for (const deviceId of this.#backoff.keys())
      if (!byDevice.has(deviceId)) this.#backoff.delete(deviceId);
    for (const [deviceId, own] of byDevice) {
      if (!force && (this.#backoff.get(deviceId)?.retryAt ?? 0) > Date.now()) continue;
      const started = performance.now();
      const days = own.map((mark) => mark.day);
      const timezone = own[0]?.timezone ?? "UTC";
      try {
        await this.#db.transaction(async (tx) => {
          await allowLongStatements(tx);
          await lockDeviceProcessing(tx, deviceId);
          await rebuildHeatDays(tx, deviceId, timezone, days);
          // The owner's streams learn of the new cells with the commit, as they do of a pass (a `heat` event, which only heat answers react to): the
          // heat answers that waited for them are asked for again.
          const sorted = [...days].sort();
          await notifySegments(tx, {
            kind: "heat",
            userId: own[0]?.user_id ?? "",
            deviceId,
            from: new Date(startOfLocalDay(sorted[0] ?? "1970-01-01", timezone)),
            to: new Date(startOfLocalDay(addDays(sorted.at(-1) ?? "1970-01-01", 1), timezone)),
          });
          // A mark made again meanwhile (its `marked_at` is later) stays for the next run.
          for (const mark of own) {
            await tx.execute(sql`
              DELETE FROM heat_day_marks
              WHERE device_id = ${deviceId}::uuid AND day = ${mark.day}::date
                AND marked_at <= ${mark.marked_at}::timestamptz
            `);
          }
        });
        this.#backoff.delete(deviceId);
        this.#logger.debug(
          { deviceId, days: days.length, heatDaysMs: Math.round(performance.now() - started) },
          "heat days rebuilt",
        );
      } catch (error) {
        const failures = (this.#backoff.get(deviceId)?.failures ?? 0) + 1;
        this.#backoff.set(deviceId, {
          failures,
          retryAt: Date.now() + Math.min(retryMaxMs, this.#retryMs * 2 ** (failures - 1)),
        });
        this.#logger.error({ err: error, deviceId, days }, "heat days could not be rebuilt");
      }
    }
    // The next run is the earliest wait that is over; a device that is well again is not in it.
    const waits = [...this.#backoff.values()].map((entry) => entry.retryAt);
    if (waits.length > 0) this.#arm(Math.max(0, Math.min(...waits) - Date.now()));
  }
}
