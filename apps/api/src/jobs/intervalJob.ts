import type { Logger } from "pino";

export interface IntervalJob {
  /** Stops scheduling and waits for a run in progress. */
  stop(): Promise<void>;
}

/**
 * Runs `task` every `intervalMs` (first run after `initialDelayMs`). Runs never
 * overlap, and a failure is logged — a job must never take the process down.
 */
export function intervalJob(options: {
  name: string;
  intervalMs: number;
  initialDelayMs: number;
  logger: Logger;
  task: () => Promise<void>;
}): IntervalJob {
  let running: Promise<void> | null = null;
  let stopped = false;

  const run = () => {
    if (stopped || running !== null) return;
    running = options
      .task()
      .catch((error: unknown) => {
        options.logger.error({ err: error, job: options.name }, "background job failed");
      })
      .finally(() => {
        running = null;
      });
  };

  const initial = setTimeout(run, options.initialDelayMs);
  const interval = setInterval(run, options.intervalMs);
  initial.unref();
  interval.unref();

  return {
    async stop() {
      stopped = true;
      clearTimeout(initial);
      clearInterval(interval);
      await running;
    },
  };
}
