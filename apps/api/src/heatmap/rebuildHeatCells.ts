import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { heatCellZooms } from "./heatCellLevels";
import { heatCellsUpsert } from "./heatCellsUpsert";

/**
 * Recomputes a device's heat cells at `levels` (every stored level unless
 * named) from its points: after deletions, `trail recompute`, or levels that
 * miss points (`fillHeatLevels`). The device's row is locked first, as an
 * upload locks it, so no upload adds to cells being rebuilt and counted
 * twice; the caller's transaction holds the lock until it commits. A stop
 * (`signal`) between two statements throws, so the caller rolls back.
 */
export async function rebuildHeatCells(
  db: Executor,
  deviceId: string,
  levels: readonly number[] = heatCellZooms,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await db.execute(sql`SELECT 1 FROM devices WHERE id = ${deviceId} FOR UPDATE`);
  signal?.throwIfAborted();
  await db.execute(
    sql`DELETE FROM heat_cells WHERE device_id = ${deviceId} AND z = ANY(${sql.param([...levels])}::smallint[])`,
  );
  signal?.throwIfAborted();
  await db.execute(
    heatCellsUpsert(
      deviceId,
      sql`(SELECT recorded_at, lat, lon, horizontal_accuracy FROM locations WHERE device_id = ${deviceId})`,
      levels,
    ),
  );
}
