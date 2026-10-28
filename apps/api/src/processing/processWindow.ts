import { eq } from "drizzle-orm";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { lockDeviceProcessing } from "./deviceLock";
import { persistWindow } from "./persistWindow";
import type { ProcessingConfig } from "./processingConfig";
import { awaitTiles, type FromLevel, finishWindows, type QueueRow } from "./processingQueue";
import { processingVersions } from "./processingVersion";
import { inferWindow, mapPiece, piecesToMap, planWindow, type StretchMapping } from "./runPipeline";
import type { TileKey } from "./tileCover";
import { cachedTiles, loadMapData, staleBefore } from "./tileStore";
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
 * grows to whole segments — at most two days out of the queued range, which
 * a window waiting for tiles keeps as it was — the points, visits, trips and overrides are read,
 * the pipeline runs with the cached map data loaded a piece at a time, the
 * results replace the window's derived rows and the queue rows are done.
 * A window queued from the inferred level keeps each move's mapped points as
 * stored by the current mapped version, so only the inference runs again (a
 * move without them is matched).
 * Tiles older than `mapping.tileMaxAgeDays` serve, and the window waits for
 * them to be fetched again. Moves whose map tiles are missing are
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

    const window = await extendWindow(tx, deviceId, span, config.stops.gapSplitS);
    const raw = await loadRawPoints(tx, deviceId, window.from, window.to);
    const visits = await loadVisits(tx, deviceId, window.from, window.to);
    const trips = await loadTrips(tx, deviceId, window.from, window.to, now);
    const overrides = await loadOverrides(tx, deviceId, window.from, window.to);
    const plan = planWindow(raw, visits, config);
    const { available, stale } = options.mapping
      ? await cachedTiles(tx, plan.tiles, staleBefore(config.mapping.tileMaxAgeDays, now))
      : { available: new Set<TileKey>(), stale: new Set<TileKey>() };
    const storedMapping =
      fromLevel === "inferred"
        ? await loadStoredMapping(tx, deviceId, plan.raw, processingVersions.mapped)
        : undefined;
    // The map data a piece at a time: a long window never holds all of it.
    const mappings: StretchMapping[] = [];
    if (options.mapping) {
      for (const piece of piecesToMap(plan, available)) {
        const map = await loadMapData(tx, piece.tiles);
        mappings.push(...mapPiece(plan, piece, map, storedMapping, config));
      }
    }
    const result = inferWindow(
      plan,
      mappings,
      { trips, overrides, mapping: options.mapping, available },
      config,
    );

    await persistWindow(tx, {
      deviceId,
      from: window.from,
      to: window.to,
      raw: plan.raw,
      result,
      versions: processingVersions,
      config,
    });
    await finishWindows(tx, rows);
    // Missing tiles, and old ones (they served this pass): the window is done again once they are
    // here — with the bounds it was queued with: the next pass grows them anew, never from these.
    const waitFor = [...new Set([...result.missingTiles, ...stale])].sort();
    if (waitFor.length > 0) {
      await awaitTiles(tx, { deviceId, ...span, fromLevel, priority }, waitFor);
    }
    return {
      deviceId,
      userId: owner.userId,
      from: window.from,
      to: window.to,
      points: raw.length,
      segments: result.segments.length,
      missingTiles: waitFor,
    };
  });
}
