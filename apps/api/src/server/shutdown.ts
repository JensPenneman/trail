import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import type { AppContext } from "../appContext";
import type { Jobs } from "../jobs/startJobs";

/** In-flight requests get this long to finish (docs/architecture.md). */
const inFlightTimeoutMs = 10_000;
/** Then statistics, alerts and the pool get a short grace period. */
const cleanupTimeoutMs = 2_000;

/**
 * Graceful stop: no new connections, live streams ended and the processing
 * channel let go, jobs and processing stopped, in-flight requests finished
 * (at most 10 s, then connections are cut), pending statistics and data
 * access rows flushed, background work drained — and what it recorded
 * flushed too — pool closed.
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
  // Nobody listens any more: the channel's connection goes first (it is not the pool's).
  const listener = ctx.processingListener.stop();
  await jobs.stop();
  // A window in progress finishes its transaction; map downloads are cut off.
  const processing = ctx.processing.stop();

  const finished = await Promise.race([
    closed.then(() => true),
    sleep(inFlightTimeoutMs).then(() => false),
  ]);
  if (!finished) {
    ctx.logger.warn("requests still running after 10 s — closing their connections");
    server.closeAllConnections();
  }

  await Promise.race([processing, sleep(cleanupTimeoutMs)]);
  await listener;
  await Promise.race([
    Promise.all([ctx.dailyStats.flush(), ctx.dataAccess.flush()]),
    sleep(cleanupTimeoutMs),
  ]);
  ctx.dailyStats.stop();
  await ctx.background.drain(cleanupTimeoutMs);
  // Background work records too (the live positions people received); usually nothing is left.
  await Promise.race([ctx.dataAccess.flush(), sleep(cleanupTimeoutMs)]);
  ctx.dataAccess.stop();
  await ctx.pool.end();
}
