import type { Logger } from "pino";
import type { Config } from "../config/config";
import { type StartedWorker, startWorker } from "./startWorker";

/**
 * A pass in progress gets this long to commit after SIGTERM: under the 90 s
 * a container is given to stop, so the worker exits on its own first.
 */
const forcedExitMs = 80_000;

/**
 * Runs the worker in this process until SIGTERM or SIGINT, then stops it:
 * no new pass is taken, the one in progress commits, the last heartbeat is
 * written and the pool closed. Resolves to the exit code: 0 after a signal, 1
 * when the worker could not start or an exception went uncaught. Should a pass
 * not commit in time the process exits anyway (1) and the database rolls the
 * pass back: it is one transaction, so it is never left half-done.
 */
export async function runWorker(input: {
  config: Config;
  logger: Logger;
  migrationsFolder: string;
}): Promise<number> {
  const { logger } = input;
  let requestStop: (reason: string) => void = () => {};
  const stopRequested = new Promise<string>((resolve) => {
    requestStop = resolve;
  });
  let crashed = false;
  const onSignal = (signal: NodeJS.Signals) => requestStop(signal);
  const onException = (error: Error) => {
    logger.fatal({ err: error }, "uncaught exception");
    crashed = true;
    requestStop("uncaught exception");
  };
  const onRejection = (reason: unknown) => {
    logger.error({ err: reason }, "unhandled promise rejection");
  };
  // Before the start: a signal while the database is awaited stops the worker once it is up.
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("uncaughtException", onException);
  process.on("unhandledRejection", onRejection);
  try {
    let worker: StartedWorker;
    try {
      worker = await startWorker(input);
    } catch (error) {
      logger.fatal({ err: error }, "worker startup failed");
      return 1;
    }
    const reason = await stopRequested;
    logger.info({ reason }, "shutting down");
    const forced = setTimeout(() => {
      logger.error("graceful shutdown timed out: the pass in progress is rolled back");
      process.exit(1);
    }, forcedExitMs);
    forced.unref();
    try {
      await worker.stop();
    } catch (error) {
      logger.error({ err: error }, "shutdown failed");
      return 1;
    } finally {
      clearTimeout(forced);
    }
    logger.info("stopped");
    return crashed ? 1 : 0;
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    process.off("uncaughtException", onException);
    process.off("unhandledRejection", onRejection);
  }
}
