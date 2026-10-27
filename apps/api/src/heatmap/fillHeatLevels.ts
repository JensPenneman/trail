import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
import { levelsToRebuild } from "./levelsToRebuild";
import { rebuildHeatCells } from "./rebuildHeatCells";

interface TotalRow extends Record<string, unknown> {
  device_id: string;
  z: number;
  total: string | number;
}

interface BackendRow extends Record<string, unknown> {
  pid: number;
  started: string;
}

/**
 * Rebuilds a device's levels in a transaction of its own, under the device's
 * lock (`rebuildHeatCells`). A stop cancels the statement in progress — that
 * of this transaction only (its backend and start), never what a pooled
 * connection runs next — and the transaction rolls back: nothing half-built
 * is kept. False when stopped.
 */
async function rebuildUnlessStopped(
  db: Database,
  deviceId: string,
  levels: readonly number[],
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await allowLongStatements(tx);
      const backend = await tx.execute<BackendRow>(
        sql`SELECT pg_backend_pid() AS pid, now()::text AS started`,
      );
      const self = backend.rows[0];
      const cancel = () => {
        if (self === undefined) return;
        db.execute(sql`
          SELECT pg_cancel_backend(pid) FROM pg_stat_activity
          WHERE pid = ${self.pid} AND xact_start = ${self.started}::timestamptz
        `).catch(() => undefined);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        // A stop just before the listener was there, or between two statements, counts too.
        signal?.throwIfAborted();
        await rebuildHeatCells(tx, deviceId, levels, signal);
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    });
    return true;
  } catch (error) {
    if (signal?.aborted === true) return false;
    throw error;
  }
}

/**
 * Brings every device's stored heat levels in line with its points, at every
 * start (docs/architecture.md §8.2, §10): the totals of every device's levels
 * (one read of the cells, milliseconds for 1.2 M points) show which levels
 * miss points (`levelsToRebuild`: those below the device's highest total) —
 * a level a release added, one an older release left behind after a
 * rollback, one short of cells — and those are rebuilt from the device's
 * points, a device at a time, each in a transaction under the device's lock,
 * so an upload of that device waits rather than being counted twice. Stopped
 * (`signal`), it cancels what it is doing — also a wait for the device's
 * lock — and the next start finds the rest. Returns how many devices were
 * rebuilt and whether every device is done.
 */
export async function fillHeatLevels(
  db: Database,
  logger: Logger,
  signal?: AbortSignal,
): Promise<{ devices: number; complete: boolean }> {
  const totals = await db.execute<TotalRow>(sql`
    SELECT h.device_id, h.z, sum(h.count) AS total
    FROM heat_cells h
    JOIN devices d ON d.id = h.device_id
    GROUP BY h.device_id, h.z, d.created_at
    ORDER BY d.created_at, h.device_id
  `);
  const byDevice = new Map<string, Map<number, number>>();
  for (const row of totals.rows) {
    const levels = byDevice.get(row.device_id) ?? new Map<number, number>();
    levels.set(Number(row.z), Number(row.total));
    byDevice.set(row.device_id, levels);
  }

  let devices = 0;
  for (const [deviceId, levelTotals] of byDevice) {
    const levels = levelsToRebuild(levelTotals);
    if (levels.length === 0) continue;
    if (signal?.aborted === true) return { devices, complete: false };
    const started = performance.now();
    if (!(await rebuildUnlessStopped(db, deviceId, levels, signal))) {
      return { devices, complete: false };
    }
    devices += 1;
    logger.info(
      { deviceId, levels, durationMs: Math.round(performance.now() - started) },
      "heat cells filled in",
    );
  }
  return { devices, complete: true };
}
