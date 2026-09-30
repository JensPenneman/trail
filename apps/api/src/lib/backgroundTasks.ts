import type { Logger } from "pino";

/**
 * Fire-and-forget work that runs after a response (alerts, statistics
 * rebuilds). Failures are logged, never thrown, and shutdown can wait for
 * whatever is still running.
 */
export class BackgroundTasks {
  readonly #logger: Logger;
  readonly #running = new Set<Promise<void>>();

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  run(name: string, task: () => Promise<void>): void {
    const promise = task()
      .catch((error: unknown) => {
        this.#logger.error({ err: error, task: name }, "background task failed");
      })
      .finally(() => {
        this.#running.delete(promise);
      });
    this.#running.add(promise);
  }

  /** Waits for running tasks, at most `timeoutMs`. */
  async drain(timeoutMs: number): Promise<void> {
    if (this.#running.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([Promise.allSettled([...this.#running]), timeout]);
    clearTimeout(timer);
  }
}
