import { eq } from "drizzle-orm";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { lockDeviceProcessing } from "./deviceLock";
import { persistWindow } from "./persistWindow";
import type { ProcessingConfig } from "./processingConfig";
import { awaitTiles, type FromLevel, finishWindows, type QueueRow } from "./processingQueue";
import { processingVersion } from "./processingVersion";
import { finishWindow, planWindow } from "./runPipeline";
import type { TileKey } from "./tileCover";
import { availableTiles, loadMapData } from "./tileStore";
import {
  extendWindow,
  loadOverrides,
  loadRawPoints,
  loadStoredMapping,
  loadTrips,
  loadVisits,
} from "./windowData";

export interface WindowOutcome {
  deviceId: string;
  userId: string;
  from: Date;
  to: Date;
  points: number;
  segments: number;
  missingTiles: readonly TileKey[];
}

const levels: readonly FromLevel[] = ["averaged", "mapped", "inferred"];

/**
 * One pass of the worker over a device's queued windows (docs/architecture.md
 * §17.4), in one transaction under the device's processing lock: the window
 * grows to whole segments, the points, visits, trips, overrides and cached map
 * data are read, the pipeline runs, the results replace the window's derived
 * rows and the queue rows are done. Moves whose map tiles are missing are
 * stored unmapped, and the window waits for those tiles. Null when the
 * device is gone.
 */
export async function processWindow(
  db: Database,
  rows: readonly QueueRow[],
  options: { config: ProcessingConfig; mapping: boolean; now: Date },
): Promise<WindowOutcome | null> {
  const [first] = rows;
  if (first === undefined) return null;
  const { deviceId } = first;
  const span = {
    from: new Date(Math.min(...rows.map((row) => row.from.getTime()))),
    to: new Date(Math.max(...rows.map((row) => row.to.getTime()))),
  };
  const fromLevel =
    levels[Math.min(...rows.map((row) => levels.indexOf(row.fromLevel)))] ?? "averaged";
  const priority = Math.min(...rows.map((row) => row.priority));
  const { config, now } = options;

  return db.transaction(async (tx) => {
    await lockDeviceProcessing(tx, deviceId);
    const [owner] = await tx
      .select({ userId: devices.userId })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    if (owner === undefined) return null;

    const window = await extendWindow(tx, deviceId, span.from, span.to);
    const raw = await loadRawPoints(tx, deviceId, window.from, window.to);
    const visits = await loadVisits(tx, deviceId, window.from, window.to);
    const trips = await loadTrips(tx, deviceId, window.from, window.to, now);
    const overrides = await loadOverrides(tx, deviceId, window.from, window.to);
    const plan = planWindow(raw, visits, config);
    const available = options.mapping ? await availableTiles(tx, plan.tiles) : new Set<TileKey>();
    const map = options.mapping ? await loadMapData(tx, available) : null;
    const storedMapping =
      fromLevel === "inferred"
        ? await loadStoredMapping(tx, deviceId, plan.raw, processingVersion)
        : undefined;
    const result = finishWindow(plan, { trips, overrides, map, available, storedMapping }, config);

    await persistWindow(tx, {
      deviceId,
      from: window.from,
      to: window.to,
      raw: plan.raw,
      result,
      version: processingVersion,
    });
    await finishWindows(tx, rows);
    if (result.missingTiles.length > 0) {
      await awaitTiles(tx, { deviceId, ...window, fromLevel, priority }, result.missingTiles);
    }
    return {
      deviceId,
      userId: owner.userId,
      from: window.from,
      to: window.to,
      points: raw.length,
      segments: result.segments.length,
      missingTiles: result.missingTiles,
    };
  });
}
