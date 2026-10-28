import type { AppContext } from "../appContext";
import { fillHeatLevels } from "../heatmap/fillHeatLevels";
import { createMapDataRefresher } from "../mapdata/createMapDataRefresher";
import { startMapDataSchedule } from "../mapdata/mapDataSchedule";
import { checkSilentDevices } from "./checkSilentDevices";
import { intervalJob } from "./intervalJob";
import { oneOffJob } from "./oneOffJob";
import { pruneExpiredData } from "./pruneExpiredData";

export interface Jobs {
  stop(): Promise<void>;
}

/** The in-process schedule of docs/architecture.md §10 (single instance). */
export function startJobs(ctx: AppContext): Jobs {
  const { alerts } = ctx;
  const jobs = [
    intervalJob({
      name: "prune",
      intervalMs: 3_600_000,
      initialDelayMs: 30_000,
      logger: ctx.logger,
      task: async () => {
        const pruned = await pruneExpiredData(ctx.db, ctx.config);
        if (Object.values(pruned).some((count) => count > 0)) {
          ctx.logger.info({ pruned }, "expired data removed");
        }
      },
    }),
    // At every start: the heat levels a release added, or an older one left behind, are rebuilt.
    oneOffJob({
      name: "heat levels",
      delayMs: 5_000,
      logger: ctx.logger,
      task: async (signal) => {
        const filled = await fillHeatLevels(ctx.db, ctx.logger, signal);
        if (!filled.complete) {
          ctx.logger.info(filled, "heat levels stopped before every device was done");
        } else if (filled.devices > 0) {
          ctx.logger.info(filled, "heat levels filled in");
        }
      },
    }),
  ];
  if (alerts !== null) {
    jobs.push(
      intervalJob({
        name: "silent devices",
        intervalMs: 5 * 60_000,
        initialDelayMs: 60_000,
        logger: ctx.logger,
        task: async () => {
          const sent = await checkSilentDevices({
            db: ctx.db,
            logger: ctx.logger,
            alerts,
            staleAfterHours: ctx.config.staleAfterHours,
          });
          if (sent > 0) ctx.logger.info({ sent }, "silent-device alerts sent");
        },
      }),
    );
  }
  // The map data of MAP_DATA_REGIONS: a look at the registry soon after the start, then
  // every MAP_DATA_REFRESH_DAYS (docs/design/self-hosted-maps.md §2.6).
  const { mapData } = ctx.config;
  if (mapData.regions.length > 0) {
    jobs.push(
      startMapDataSchedule({
        refresher: createMapDataRefresher({
          config: ctx.config,
          pool: ctx.pool,
          logger: ctx.logger,
        }),
        refreshDays: mapData.refreshDays,
        logger: ctx.logger.child({ component: "mapdata" }),
      }),
    );
  }
  return {
    async stop() {
      await Promise.all(jobs.map((job) => job.stop()));
    },
  };
}
