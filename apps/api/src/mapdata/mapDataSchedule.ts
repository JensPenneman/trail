import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "pino";
import type { RefreshOutcome } from "./mapDataRefresher";

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
/** The longest sleep at once: Node's timers hold at most 24.8 days, the period may be longer. */
const maxSleepMs = 6 * hourMs;

/** What the schedule needs of the refresher. */
export interface ScheduledRefresher {
  regions(): string[];
  refresh(region: string, signal: AbortSignal): Promise<RefreshOutcome>;
}

export interface MapDataSchedule {
  /** Stops the schedule, cancels a refresh under way (its download is deleted) and waits for it. */
  stop(): Promise<void>;
}

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  sleep(ms, undefined, { signal, ref: false }).then(() => undefined);

/**
 * The refresh schedule of the worker (docs/design/self-hosted-maps.md §2.6):
 * a first look at every region a few minutes after the start (a new install
 * pulls its regions at once, a restore finds its build again), then one
 * every `refreshDays` days and up to six hours more, so that the servers of
 * one release do not all ask at the same moment. A refresh pulls only when
 * the registry has another build that is not older; a failed one is tried
 * again after 15 minutes, doubling up to a day; another process refreshing
 * the region, after an hour. One region at a time; failures are logged by
 * the refresher, never thrown.
 */
export function startMapDataSchedule(input: {
  refresher: ScheduledRefresher;
  refreshDays: number;
  logger: Logger;
  /** The first look, after this and up to three minutes more. */
  startDelayMs?: number;
  /** For tests: the clock, the dice and the sleep. */
  now?: () => number;
  random?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): MapDataSchedule {
  const now = input.now ?? Date.now;
  const random = input.random ?? Math.random;
  const pause = input.wait ?? wait;
  const startDelayMs = input.startDelayMs ?? 2 * minuteMs;
  const regions = input.refresher.regions();
  const abort = new AbortController();
  const due = new Map<string, number>();
  const failures = new Map<string, number>();
  for (const region of regions) {
    due.set(region, now() + startDelayMs + random() * 3 * minuteMs);
  }
  input.logger.info({ regions, refreshDays: input.refreshDays }, "map data refresh scheduled");

  const next = (region: string, outcome: RefreshOutcome | null): number => {
    if (outcome?.busy === true) return now() + hourMs;
    if (outcome === null || outcome.failures.length > 0) {
      const count = (failures.get(region) ?? 0) + 1;
      failures.set(region, count);
      const backoff = Math.min(dayMs, 15 * minuteMs * 2 ** (count - 1));
      return now() + backoff * (1 + random() * 0.2);
    }
    failures.delete(region);
    return now() + input.refreshDays * dayMs + random() * maxSleepMs;
  };

  const loop = (async () => {
    while (!abort.signal.aborted && regions.length > 0) {
      const soonest = Math.min(...due.values());
      try {
        await pause(Math.max(0, Math.min(soonest - now(), maxSleepMs)), abort.signal);
      } catch {
        break;
      }
      for (const region of regions) {
        if (abort.signal.aborted) break;
        if ((due.get(region) ?? Number.POSITIVE_INFINITY) > now()) continue;
        let outcome: RefreshOutcome | null = null;
        try {
          outcome = await input.refresher.refresh(region, abort.signal);
        } catch (error) {
          if (abort.signal.aborted) break;
          input.logger.error({ region, err: error }, "map region refresh failed");
        }
        const at = next(region, outcome);
        due.set(region, at);
        input.logger.debug({ region, next: new Date(at).toISOString() }, "map region next check");
      }
    }
  })();

  return {
    async stop() {
      abort.abort();
      await loop;
    },
  };
}
