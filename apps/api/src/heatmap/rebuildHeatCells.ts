import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { heatCellsUpsert } from "./heatCellsUpsert";

/** Recomputes a device's heat cells from its points (after deletions, or `trail recompute`). */
export async function rebuildHeatCells(db: Executor, deviceId: string): Promise<void> {
  await db.execute(sql`DELETE FROM heat_cells WHERE device_id = ${deviceId}`);
  await db.execute(
    heatCellsUpsert(
      deviceId,
      sql`(SELECT recorded_at, lat, lon, horizontal_accuracy FROM locations WHERE device_id = ${deviceId})`,
    ),
  );
}
