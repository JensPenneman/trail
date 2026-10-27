import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { heatCellZooms } from "./heatCellLevels";
import { heatCellsUpsert } from "./heatCellsUpsert";

/**
 * Recomputes a device's heat cells at `levels` (every stored level unless
 * named) from its points: after deletions, `trail recompute`, or a stored
 * level that is new (`fillHeatLevels`). The device's row is locked first, as
 * an upload locks it, so no upload adds to cells being rebuilt and counted
 * twice; the caller's transaction holds the lock until it commits.
 */
export async function rebuildHeatCells(
  db: Executor,
  deviceId: string,
  levels: readonly number[] = heatCellZooms,
): Promise<void> {
  await db.execute(sql`SELECT 1 FROM devices WHERE id = ${deviceId} FOR UPDATE`);
  await db.execute(
    sql`DELETE FROM heat_cells WHERE device_id = ${deviceId} AND z = ANY(${sql.param([...levels])}::smallint[])`,
  );
  await db.execute(
    heatCellsUpsert(
      deviceId,
      sql`(SELECT recorded_at, lat, lon, horizontal_accuracy FROM locations WHERE device_id = ${deviceId})`,
      levels,
    ),
  );
}
