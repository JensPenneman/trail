import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { allowLongStatements } from "../db/allowLongStatements";
import type { Database } from "../db/database";
import { heatCellZooms } from "./heatCellLevels";
import { rebuildHeatCells } from "./rebuildHeatCells";

/** The levels every version stored before the stored levels were recorded. */
const levelsBeforeRecording: readonly number[] = [6, 9, 12, 15, 18];

/** The `processing_state` key: `{ levels }`, the levels every device's cells are complete at. */
const stateKey = "heat_levels";

interface StateRow extends Record<string, unknown> {
  value: unknown;
}

interface DeviceRow extends Record<string, unknown> {
  id: string;
}

/** The levels a `processing_state` value records; the old five when nothing was recorded. */
export function recordedHeatLevels(value: unknown): readonly number[] {
  if (typeof value === "object" && value !== null) {
    const { levels } = value as { levels?: unknown };
    if (Array.isArray(levels) && levels.every((level) => Number.isInteger(level))) {
      return levels as number[];
    }
  }
  return levelsBeforeRecording;
}

/**
 * Fills in the stored heat levels a release added (docs/architecture.md §8.2,
 * §10): the cells of earlier uploads lack them until every device's are built
 * from its points, once, after the upgrade. A device at a time, each in a
 * transaction of its own under the device's lock (`rebuildHeatCells`), so an
 * upload waits for its device rather than being counted twice; the levels
 * are recorded in `processing_state` once every device has them. Stopped
 * half-way (`signal`), nothing is recorded and the next start begins again —
 * rebuilding a device is the same however often it is done. Returns the
 * levels filled in and how many devices had them filled in.
 */
export async function fillHeatLevels(
  db: Database,
  logger: Logger,
  signal?: AbortSignal,
): Promise<{ levels: number[]; devices: number }> {
  const state = await db.execute<StateRow>(
    sql`SELECT value FROM processing_state WHERE key = ${stateKey}`,
  );
  const recorded = recordedHeatLevels(state.rows[0]?.value ?? null);
  const missing = heatCellZooms.filter((level) => !recorded.includes(level));
  const current = heatCellZooms.every((level) => recorded.includes(level));
  if (state.rows.length > 0 && current) return { levels: [], devices: 0 };

  let filled = 0;
  if (missing.length > 0) {
    const devices = await db.execute<DeviceRow>(
      sql`SELECT id FROM devices ORDER BY created_at, id`,
    );
    for (const device of devices.rows) {
      if (signal?.aborted === true) return { levels: missing, devices: filled };
      const started = performance.now();
      await db.transaction(async (tx) => {
        await allowLongStatements(tx);
        await rebuildHeatCells(tx, device.id, missing);
      });
      filled += 1;
      logger.info(
        {
          deviceId: device.id,
          levels: missing,
          durationMs: Math.round(performance.now() - started),
        },
        "heat cells filled in",
      );
    }
  }
  await db.execute(sql`
    INSERT INTO processing_state (key, value, updated_at)
    VALUES (${stateKey}, ${JSON.stringify({ levels: heatCellZooms })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  return { levels: missing, devices: filled };
}
