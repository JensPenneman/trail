import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import type { AppContext } from "../appContext";
import type { Jobs } from "../jobs/startJobs";

/** In-flight requests get this long to finish (docs/architecture.md). */
const inFlightTimeoutMs = 10_000;
/** Then statistics, alerts and the pool get a short grace period. */
const cleanupTimeoutMs = 2_000;

/**
 * Graceful stop: no new connections, live streams ended, jobs stopped,
 * in-flight requests finished (at most 10 s, then connections are cut),
 * pending statistics flushed, background work drained, pool closed.
 */
export async function shutdown(input: {
  server: Server;
  ctx: AppContext;
  jobs: Jobs;
}): Promise<void> {
  const { server, ctx, jobs } = input;
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  ctx.bus.disconnectAll();
  server.closeIdleConnections();
  await jobs.stop();

  const finished = await Promise.race([
    closed.then(() => true),
    sleep(inFlightTimeoutMs).then(() => false),
  ]);
  if (!finished) {
    ctx.logger.warn("requests still running after 10 s — closing their connections");
    server.closeAllConnections();
  }

  await Promise.race([ctx.dailyStats.flush(), sleep(cleanupTimeoutMs)]);
  ctx.dailyStats.stop();
  await ctx.background.drain(cleanupTimeoutMs);
  await ctx.pool.end();
}
