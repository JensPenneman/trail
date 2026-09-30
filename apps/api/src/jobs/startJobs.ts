import type { AppContext } from "../appContext";
import { checkSilentDevices } from "./checkSilentDevices";
import { intervalJob } from "./intervalJob";
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
        const pruned = await pruneExpiredData(ctx.db);
        if (Object.values(pruned).some((count) => count > 0)) {
          ctx.logger.info({ pruned }, "expired data removed");
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
  return {
    async stop() {
      await Promise.all(jobs.map((job) => job.stop()));
    },
  };
}
