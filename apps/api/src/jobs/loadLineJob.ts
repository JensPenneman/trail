import { monitorEventLoopDelay } from "node:perf_hooks";
import type { AppContext } from "../appContext";
import { buildLoadLine } from "../load/loadLine";
import { processingQueueState } from "../load/processingQueueState";
import type { IntervalJob } from "./intervalJob";
import { intervalJob } from "./intervalJob";

/** Once a minute, as the load harness reads it (docs/perf/README.md). */
const defaultIntervalMs = 60_000;
/** The histogram's timer; what it records is the time between two ticks, this included. */
const resolutionMs = 10;

/**
 * Logs the `load` line every minute at `info` (docs/design/capacity.md §6.3):
 * event-loop delay, the pool, open streams, background work, the minute's
 * uploads and points, memory and the processing queue's age. Numbers only, for
 * `docker logs` and the load harness's collector; no endpoint, no new data.
 */
export function loadLineJob(ctx: AppContext, intervalMs = defaultIntervalMs): IntervalJob {
  const loop = monitorEventLoopDelay({ resolution: resolutionMs });
  loop.enable();
  const job = intervalJob({
    name: "load line",
    intervalMs,
    initialDelayMs: intervalMs,
    logger: ctx.logger,
    task: async () => {
      // The delay is what a tick came late: the recorded time between two ticks less the timer's.
      const late = (ns: number) => Math.max(0, ns - resolutionMs * 1e6);
      const eventLoopNs = {
        p50: late(loop.percentile(50)),
        p99: late(loop.percentile(99)),
        max: late(loop.max),
      };
      loop.reset();
      const processing = await processingQueueState(ctx.db).catch(() => null);
      const memory = process.memoryUsage();
      ctx.logger.info(
        buildLoadLine({
          intervalS: intervalMs / 1000,
          eventLoopNs,
          pool: {
            total: ctx.pool.totalCount,
            idle: ctx.pool.idleCount,
            waiting: ctx.pool.waitingCount,
          },
          streams: ctx.bus.streamCount(),
          background: ctx.background.size,
          dailyStatsDays: ctx.dailyStats.pendingDays(),
          ingest: ctx.ingestMeter.take(),
          memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
          processing,
        }),
        "load",
      );
    },
  });
  return {
    async stop() {
      await job.stop();
      loop.disable();
    },
  };
}
