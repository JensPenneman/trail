/*
 * What the unit projects' Vitest configs share (docs/architecture.md §16):
 * Launchway runs the checks in containers limited to a few of a node's CPUs,
 * so the tests must hold on a slow, CPU-limited machine as much as on this one.
 */
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";

/** A file's text, or undefined when it cannot be read (no such cgroup file, not Linux). */
export type ReadText = (path: string) => string | undefined;

const readText: ReadText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/** Whole CPUs, at least one, as libuv rounds a cgroup v2 quota for os.availableParallelism(). */
function wholeCpus(quota: string | undefined, period: string | undefined): number | undefined {
  const quotaUs = Number(quota);
  const periodUs = Number(period);
  // "max" (v2) and -1 (v1) mean no quota
  if (!(quotaUs > 0 && periodUs > 0)) return undefined;
  return Math.max(1, Math.floor(quotaUs / periodUs));
}

/**
 * The CPUs a cgroup CPU quota grants this process, or undefined without one.
 * A container sees its own cgroup at the root of /sys/fs/cgroup: cgroup v2
 * keeps "<quota> <period>" in microseconds in `cpu.max` ("max <period>"
 * without a quota), cgroup v1 the two in `cpu.cfs_quota_us` (-1 without) and
 * `cpu.cfs_period_us` of the cpu controller.
 */
export function cgroupCpuQuota(read: ReadText = readText): number | undefined {
  const cpuMax = read("/sys/fs/cgroup/cpu.max");
  if (cpuMax !== undefined) {
    const [quota, period] = cpuMax.trim().split(/\s+/);
    return wholeCpus(quota, period);
  }
  for (const controller of ["/sys/fs/cgroup/cpu", "/sys/fs/cgroup/cpu,cpuacct"]) {
    const quota = read(`${controller}/cpu.cfs_quota_us`);
    if (quota !== undefined) return wholeCpus(quota, read(`${controller}/cpu.cfs_period_us`));
  }
  return undefined;
}

/** A unit project's pool size (under a CPU quota only) and timeouts. */
interface UnitTestOptions {
  maxWorkers?: number;
  testTimeout: number;
  hookTimeout: number;
}

/**
 * Vitest gives `vitest run` a worker per CPU but one, the CPU the main process
 * keeps for the transforms, and counts the CPUs with os.availableParallelism().
 * Node counts a cgroup v2 quota there when libuv finds it, a v1 quota never
 * (libuv looks for v1's files at a path that does not exist): in a check
 * container that may use 4 of a node's 12 threads, Vitest started 11 workers
 * and jsdom page tests ran out of time. Under a quota below that count, the
 * same rule sizes the pool from the quota's CPUs; otherwise Vitest's default
 * stays (half the CPUs in watch mode). Vitest's own VITEST_MAX_WORKERS
 * overrides either.
 *
 * Page tests render whole pages whose code is compiled on first use: a second
 * here, many on a slower CPU under a quota. Every unit project gives a test
 * 20 s and a hook 30 s, so a slow machine fails on a hang only.
 *
 * The configs pass nothing; tests pass the machine's files and CPU count.
 */
export function unitTestOptions(
  read: ReadText = readText,
  cpus: number = availableParallelism(),
): UnitTestOptions {
  const timeouts = { testTimeout: 20_000, hookTimeout: 30_000 };
  const quota = cgroupCpuQuota(read);
  if (quota === undefined || quota >= cpus) return timeouts;
  return { ...timeouts, maxWorkers: Math.max(1, quota - 1) };
}
