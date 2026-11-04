import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
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
}

/**
 * Rebuilds the per-day heat cells after processing (docs/architecture.md §8.2). A pass marks the
 * (device, local day) pairs it touched in `heat_day_marks`, in its own transaction; a run some
 * seconds after the first wake-up reads the marks, rebuilds the days of each device in a
 * transaction of its own under its processing lock, and deletes the marks it served (one made
 * again meanwhile stays). Because the marks are rows, a crash, a kill or an error loses none:
 * a failed run is logged and tried again with a growing wait, and at start `recover` marks recent
 * days whose points or segments are newer than their cells and drains what is marked. An error
 * here never rolls back, retries or stalls a pass.
 */
export class HeatDaysScheduler {
  readonly #db: Database;
  readonly #logger: Logger;
  readonly #delayMs: number;
  readonly #retryMs: number;
  #failures = 0;
  #timer: NodeJS.Timeout | undefined;
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

  /** Drains the marks now and waits for it (tests, shutdown). */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
    await this.#run();
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
      await this.#db.execute(sql`
        INSERT INTO heat_day_marks (device_id, day, marked_at)
        SELECT w.device_id, w.day, now()
        FROM (
          SELECT p.device_id, (p.recorded_at AT TIME ZONE u.timezone)::date AS day,
            max(p.processed_at) AS newest
          FROM processed_points p
          JOIN devices d ON d.id = p.device_id JOIN users u ON u.id = d.user_id
          WHERE p.recorded_at >= now() - ${`${recoverDays + 1} days`}::interval
          GROUP BY 1, 2
          UNION ALL
          SELECT s.device_id, (s.started_at AT TIME ZONE u.timezone)::date, max(s.computed_at)
          FROM segments s
          JOIN devices d ON d.id = s.device_id JOIN users u ON u.id = d.user_id
          WHERE s.started_at >= now() - ${`${recoverDays + 1} days`}::interval
          GROUP BY 1, 2
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

  #arm(ms: number): void {
    if (this.#stopped || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run();
    }, ms);
    this.#timer.unref();
  }

  async #run(): Promise<void> {
    if (this.#running !== null) {
      await this.#running;
      return;
    }
    this.#running = this.#drain().finally(() => {
      this.#running = null;
    });
    await this.#running;
  }

  /** Serves every mark there is; when a device's rebuild fails, tries again after a wait. */
  async #drain(): Promise<void> {
    let marks: MarkRow[];
    try {
      marks = (
        await this.#db.execute<MarkRow>(sql`
          SELECT m.device_id, m.day::text AS day, m.marked_at::text AS marked_at, u.timezone
          FROM heat_day_marks m JOIN devices d ON d.id = m.device_id JOIN users u ON u.id = d.user_id
          ORDER BY m.device_id, m.day
        `)
      ).rows;
    } catch (error) {
      this.#logger.error({ err: error }, "heat days could not be read");
      this.#retry();
      return;
    }
    const byDevice = new Map<string, MarkRow[]>();
    for (const mark of marks)
      byDevice.set(mark.device_id, [...(byDevice.get(mark.device_id) ?? []), mark]);
    let failed = false;
    for (const [deviceId, own] of byDevice) {
      const started = performance.now();
      const days = own.map((mark) => mark.day);
      const timezone = own[0]?.timezone ?? "UTC";
      try {
        await this.#db.transaction(async (tx) => {
          await allowLongStatements(tx);
          await lockDeviceProcessing(tx, deviceId);
          await rebuildHeatDays(tx, deviceId, timezone, days);
          // A mark made again meanwhile (its `marked_at` is later) stays for the next run.
          for (const mark of own) {
            await tx.execute(sql`
              DELETE FROM heat_day_marks
              WHERE device_id = ${deviceId}::uuid AND day = ${mark.day}::date
                AND marked_at <= ${mark.marked_at}::timestamptz
            `);
          }
        });
        this.#logger.debug(
          { deviceId, days: days.length, heatDaysMs: Math.round(performance.now() - started) },
          "heat days rebuilt",
        );
      } catch (error) {
        failed = true;
        this.#logger.error({ err: error, deviceId, days }, "heat days could not be rebuilt");
      }
    }
    if (failed) this.#retry();
    else this.#failures = 0;
  }

  #retry(): void {
    this.#failures += 1;
    this.#arm(Math.min(retryMaxMs, this.#retryMs * 2 ** (this.#failures - 1)));
  }
}
