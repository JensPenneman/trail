import { eq, sql } from "drizzle-orm";
import type { Database, Executor } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import { notifySegments } from "../events/processingNotify";
import { heatDaysOf } from "../heatmap/heatDaysOf";
import { lockDeviceProcessing } from "./deviceLock";
import { persistWindow } from "./persistWindow";
import type { ProcessingConfig } from "./processingConfig";
import {
  awaitTiles,
  deferLiveWindows,
  enqueueWindow,
  type FromLevel,
  finishWindows,
  type QueueRow,
  queuePriority,
} from "./processingQueue";
import { processingVersions } from "./processingVersion";
import type { RegionCoverageStore } from "./regionCoverageStore";
import {
  inferWindow,
  mapPiece,
  piecesToAlign,
  piecesToMap,
  planWindow,
  type RailInputs,
  type RailStretch,
  railPiece,
  type StretchMapping,
  type WindowPlan,
} from "./runPipeline";
import { splitJob } from "./splitJob";
import type { TileKey } from "./tileCover";
import { cachedTiles, loadMapData, loadRailMapData, staleBefore } from "./tileStore";
import {
  extendWindow,
  loadOverrides,
  loadRawPoints,
  loadStayBefore,
  loadStoredMapping,
  loadTrips,
  loadVisits,
} from "./windowData";

export interface WindowOutcome {
  deviceId: string;
  userId: string;
  /** The window worked out: the queued range grown to whole segments. */
  from: Date;
  to: Date;
  /** The queued range the pass took on: all of the rows', or the newest part of a split. */
  queued: { from: Date; to: Date };
  /** Whether the rows were too big for one pass: their older part waits in the queue. */
  split: boolean;
  /** The raw points read. */
  points: number;
  segments: number;
  missingTiles: readonly TileKey[];
  /** The local days (in the owner's zone) the pass touched, whose per-day heat cells are to be rebuilt. */
  heatDays: string[];
}

const levels: readonly FromLevel[] = ["averaged", "mapped", "inferred"];

/**
 * One pass of the worker over a device's queued windows (docs/architecture.md
 * §17.4), in one transaction under the device's processing lock, bounded by
 * `config.passes`: rows holding more points than a pass may read are split
 * first, the pass going on with their newest part and queuing the older one
 * (as repair when it was an upload's); the window grows to whole segments
 * within the budget — at most two days out of the queued range, which a
 * window waiting for tiles keeps as it was — the points, visits, trips and
 * overrides are read, the pipeline runs with the cached map data loaded a
 * piece at a time, the results replace the window's derived rows and the
 * queue rows are done. An upload queued meanwhile waits for the device's pass
 * interval.
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
  options: {
    config: ProcessingConfig;
    mapping: boolean;
    now: Date;
    /** The loaded regions, which give a train its rail ways when the tile cache does not hold them (§17.3). */
    regions?: RegionCoverageStore | null;
  },
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
  const live = priority === queuePriority.live;
  const { config, now } = options;
  const { gapSplitS } = config.stops;

  return db.transaction(async (tx) => {
    await lockDeviceProcessing(tx, deviceId);
    const [owner] = await tx
      .select({ userId: devices.userId, timezone: users.timezone })
      .from(devices)
      .innerJoin(users, eq(users.id, devices.userId))
      .where(eq(devices.id, deviceId))
      .limit(1);
    if (owner === undefined) return null;

    const split = await splitJob(tx, deviceId, span, { budget: config.passes, gapSplitS });
    const queued = split.span;
    const window = await extendWindow(tx, deviceId, queued, {
      gapSplitS,
      maxPoints: config.passes.maxPoints,
    });
    const raw = await loadRawPoints(tx, deviceId, window.from, window.to);
    const visits = await loadVisits(tx, deviceId, window.from, window.to);
    const trips = await loadTrips(tx, deviceId, window.from, window.to, now);
    const overrides = await loadOverrides(tx, deviceId, window.from, window.to);
    // A toggle set during a stay the window continues: where that stay began.
    const toggles = overrides.filter((override) => override.kind === "toggle");
    const stayBefore =
      toggles.length === 0
        ? null
        : await loadStayBefore(
            tx,
            deviceId,
            window.from,
            new Date(Math.min(...toggles.map((toggle) => toggle.from)) * 1000),
          );
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
    const rail = await railInputs(tx, plan, available, options);
    const result = inferWindow(
      plan,
      mappings,
      { trips, overrides, mapping: options.mapping, available, stayBefore, rail },
      config,
    );

    // The rows are done first: a part of a stale segment the window cuts off is queued afresh, not
    // merged into a row of this pass (one starting where the segment did) and kept with its range.
    await finishWindows(tx, rows);
    await persistWindow(tx, {
      deviceId,
      from: window.from,
      to: window.to,
      raw: plan.raw,
      result,
      versions: processingVersions,
      config,
    });
    // The days it touched in the owner's zone are marked, in this transaction: their cells for the
    // heatmap are rebuilt once the pass has committed, apart from it (HeatDaysScheduler), and a
    // crash before then loses nothing.
    const heatDays = heatDaysOf(window.from, window.to, owner.timezone);
    await tx.execute(sql`
      INSERT INTO heat_day_marks (device_id, day, marked_at)
      SELECT ${deviceId}::uuid, d::date, now() FROM unnest(${sql.param(heatDays)}::text[]) AS d
      ON CONFLICT (device_id, day) DO UPDATE SET marked_at = excluded.marked_at
    `);
    // The older part of a split keeps the rows' reason and level; an upload's is repair: history
    // that must not hold up the fresh points of other devices.
    if (split.older !== null) {
      const head = rows.find((row) => row.priority === priority) ?? first;
      await enqueueWindow(tx, {
        deviceId,
        ...split.older,
        reason: live ? "split" : head.reason,
        fromLevel,
        priority: live ? queuePriority.repair : priority,
      });
    }
    // Missing tiles, and old ones (they served this pass): the window is done again once they are
    // here — with the bounds it was queued with: the next pass grows them anew, never from these.
    const waitFor = [...new Set([...result.missingTiles, ...stale])].sort();
    if (waitFor.length > 0) {
      await awaitTiles(tx, { deviceId, ...queued, fromLevel, priority }, waitFor);
    }
    await deferLiveWindows(tx, deviceId);
    // The owner's streams learn of it with the commit, whichever process ran the pass (§9).
    await notifySegments(tx, { userId: owner.userId, deviceId, from: window.from, to: window.to });
    return {
      deviceId,
      userId: owner.userId,
      from: window.from,
      to: window.to,
      queued,
      split: split.older !== null,
      points: raw.length,
      segments: result.segments.length,
      missingTiles: waitFor,
      heatDays,
    };
  });
}

/**
 * The rail ways the aligner has beside the cache's: a move whose tiles are not
 * all cached but all covered by a ready region is read rail-only and aligned,
 * a piece at a time (docs/architecture.md §17.3); the mapped level stays as it
 * is. Null, nothing judged, with the aligner off or without any map data (no
 * Overpass and no ready region). One small query per pass.
 */
async function railInputs(
  tx: Executor,
  plan: WindowPlan,
  available: ReadonlySet<TileKey>,
  options: { config: ProcessingConfig; mapping: boolean; regions?: RegionCoverageStore | null },
): Promise<RailInputs | null> {
  const { config, regions } = options;
  if (!config.rail.enabled) return null;
  const coverage = regions === null || regions === undefined ? null : await regions.current(tx);
  if (!options.mapping && regions?.ready !== true) return null;
  const railAvailable = new Set(available);
  for (const tile of coverage?.covered(plan.tiles) ?? []) railAvailable.add(tile);
  const stretches: RailStretch[] = [];
  for (const piece of piecesToAlign(plan, available, railAvailable)) {
    const map = await loadRailMapData(tx, piece.tiles, config.rail.railOnlyMaxTiles);
    stretches.push(...railPiece(plan, piece, map, config));
  }
  return { available: railAvailable, stretches, waiting: options.mapping };
}
