import type { Logger } from "pino";
import type { IntervalJob } from "./intervalJob";

/**
 * Runs `task` once, `delayMs` after the start (the server answers first). A
 * failure is logged, never thrown; `stop` asks the task to stop through its
 * signal and waits for it.
 */
export function oneOffJob(options: {
  name: string;
  delayMs: number;
  logger: Logger;
  task: (signal: AbortSignal) => Promise<void>;
}): IntervalJob {
  const abort = new AbortController();
  let running: Promise<void> | null = null;
  const timer = setTimeout(() => {
    running = options.task(abort.signal).catch((error: unknown) => {
      options.logger.error({ err: error, job: options.name }, "background job failed");
    });
  }, options.delayMs);
  timer.unref();

  return {
    async stop() {
      clearTimeout(timer);
      abort.abort();
      await running;
    },
  };
}
