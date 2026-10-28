import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/logging/createLogger";
import type { RefreshOutcome } from "../../src/mapdata/mapDataRefresher";
import { startMapDataSchedule } from "../../src/mapdata/mapDataSchedule";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const outcome = (region: string, overrides: Partial<RefreshOutcome> = {}): RefreshOutcome => ({
  region,
  registry: null,
  build: null,
  pulled: null,
  keptNewer: false,
  tables: null,
  imported: null,
  removed: [],
  busy: false,
  failures: [],
  ...overrides,
});

const failed = (region: string) =>
  outcome(region, { failures: [{ stage: "registry", reason: "unreachable", message: "away" }] });

/**
 * The schedule on a clock of its own: every sleep moves the clock on (on the
 * next turn of the event loop, so that `stop` can come in between), and the
 * refresher answers what `answer` says, recording when it was asked.
 */
function scheduled(options: {
  regions: string[];
  refreshDays?: number;
  answer?: (region: string, call: number) => RefreshOutcome | "hang";
}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const calls: { region: string; at: number }[] = [];
  const schedule = startMapDataSchedule({
    refresher: {
      regions: () => options.regions,
      refresh: (region, signal) => {
        calls.push({ region, at: clock });
        const answer = options.answer?.(region, calls.length) ?? outcome(region);
        if (answer !== "hang") return Promise.resolve(answer);
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    },
    refreshDays: options.refreshDays ?? 30,
    logger: createLogger({ level: "silent" }),
    startDelayMs: 2 * minute,
    now: () => clock,
    random: () => 0,
    wait: (ms, signal) =>
      new Promise((resolve, reject) => {
        sleeps.push(ms);
        setImmediate(() => {
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          clock += ms;
          resolve();
        });
      }),
  });
  const until = async (count: number) => {
    while (calls.length < count) await new Promise((resolve) => setImmediate(resolve));
  };
  return { schedule, calls, sleeps, until, start: 1_000_000 };
}

describe("the map data refresh schedule", () => {
  it("looks at every region soon after the start, then every refresh period", async () => {
    const run = scheduled({ regions: ["belgium", "world"], refreshDays: 30 });
    await run.until(4);
    await run.schedule.stop();
    expect(run.calls.slice(0, 4)).toEqual([
      { region: "belgium", at: run.start + 2 * minute },
      { region: "world", at: run.start + 2 * minute },
      { region: "belgium", at: run.start + 2 * minute + 30 * day },
      { region: "world", at: run.start + 2 * minute + 30 * day },
    ]);
    // Node's timers hold 24.8 days at most: the schedule sleeps six hours at a time.
    expect(Math.max(...run.sleeps)).toBeLessThanOrEqual(6 * hour);
  });

  it("tries a failed region again after 15 minutes, doubling up to a day", async () => {
    const run = scheduled({ regions: ["belgium"], answer: (region) => failed(region) });
    await run.until(9);
    await run.schedule.stop();
    const gaps = run.calls.slice(1, 9).map((call, index) => call.at - (run.calls[index]?.at ?? 0));
    expect(gaps).toEqual([15, 30, 60, 120, 240, 480, 960, 1440].map((minutes) => minutes * minute));
  });

  it("starts the period again after a success that follows failures", async () => {
    const run = scheduled({
      regions: ["belgium"],
      answer: (region, call) => (call <= 2 ? failed(region) : outcome(region)),
    });
    await run.until(5);
    await run.schedule.stop();
    const at = run.calls.map((call) => call.at);
    expect(at[1]).toBe((at[0] ?? 0) + 15 * minute);
    expect(at[2]).toBe((at[1] ?? 0) + 30 * minute);
    expect(at[3]).toBe((at[2] ?? 0) + 30 * day);
    expect(at[4]).toBe((at[3] ?? 0) + 30 * day);
  });

  it("waits an hour when another process is refreshing the region", async () => {
    const run = scheduled({
      regions: ["belgium"],
      answer: (region, call) => outcome(region, { busy: call === 1 }),
    });
    await run.until(2);
    await run.schedule.stop();
    expect((run.calls[1]?.at ?? 0) - (run.calls[0]?.at ?? 0)).toBe(hour);
  });

  it("stops a refresh under way when it is stopped", async () => {
    const run = scheduled({ regions: ["belgium"], answer: () => "hang" });
    await run.until(1);
    await run.schedule.stop();
    expect(run.calls).toHaveLength(1);
  });

  it("does nothing without regions", async () => {
    const run = scheduled({ regions: [] });
    await run.schedule.stop();
    expect(run.calls).toEqual([]);
  });
});
