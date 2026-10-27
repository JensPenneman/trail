/*
 * The unit projects' shared Vitest settings live at the root (vitest.shared.ts);
 * their test runs here, in the unit project that runs in Node.
 */
import { availableParallelism } from "node:os";
import { describe, expect, it } from "vitest";
import { cgroupCpuQuota, type ReadText, unitTestOptions } from "../../../../vitest.shared";

/** A machine whose only files are these. */
const machine =
  (files: Record<string, string>): ReadText =>
  (path) =>
    files[path];

const v1 = (controller: string, quota: string, period: string) => ({
  [`/sys/fs/cgroup/${controller}/cpu.cfs_quota_us`]: quota,
  [`/sys/fs/cgroup/${controller}/cpu.cfs_period_us`]: period,
});

describe("a cgroup CPU quota", () => {
  it("is read from cgroup v2's cpu.max", () => {
    expect(cgroupCpuQuota(machine({ "/sys/fs/cgroup/cpu.max": "400000 100000\n" }))).toBe(4);
  });

  it("is none when cpu.max says max", () => {
    expect(cgroupCpuQuota(machine({ "/sys/fs/cgroup/cpu.max": "max 100000\n" }))).toBeUndefined();
  });

  it("counts whole CPUs, at least one, as Node counts a v2 quota", () => {
    const quota = (cpuMax: string) => cgroupCpuQuota(machine({ "/sys/fs/cgroup/cpu.max": cpuMax }));
    expect(quota("250000 100000")).toBe(2);
    expect(quota("150000 100000")).toBe(1);
    expect(quota("25000 100000")).toBe(1);
    expect(quota("200000 50000")).toBe(4);
  });

  it("is read from cgroup v1's quota and period, under either name of the cpu controller", () => {
    expect(cgroupCpuQuota(machine(v1("cpu", "200000\n", "100000\n")))).toBe(2);
    expect(cgroupCpuQuota(machine(v1("cpu,cpuacct", "300000\n", "100000\n")))).toBe(3);
  });

  it("is none when cgroup v1 sets none (-1)", () => {
    expect(cgroupCpuQuota(machine(v1("cpu", "-1\n", "100000\n")))).toBeUndefined();
  });

  it("is none without cgroup files: macOS, Windows, or Linux without a cpu controller", () => {
    expect(cgroupCpuQuota(machine({}))).toBeUndefined();
    expect(cgroupCpuQuota(machine({ "/sys/fs/cgroup/memory.max": "max\n" }))).toBeUndefined();
  });

  it("is none when the files make no sense", () => {
    for (const cpuMax of ["", "400000", "x 100000", "400000 0", "-1 100000"]) {
      expect(cgroupCpuQuota(machine({ "/sys/fs/cgroup/cpu.max": cpuMax }))).toBeUndefined();
    }
    expect(
      cgroupCpuQuota(machine({ "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "200000\n" })),
    ).toBeUndefined();
  });
});

describe("the unit projects' options", () => {
  const cpuMax = (content: string) => machine({ "/sys/fs/cgroup/cpu.max": content });
  const timeoutsOnly = { testTimeout: 20_000, hookTimeout: 30_000 };

  it("size the pool from a quota below the CPUs Node counts, a worker per CPU but one", () => {
    expect(unitTestOptions(cpuMax("400000 100000\n"), 12)).toEqual({
      ...timeoutsOnly,
      maxWorkers: 3,
    });
    expect(unitTestOptions(machine(v1("cpu,cpuacct", "400000\n", "100000\n")), 12)).toEqual({
      ...timeoutsOnly,
      maxWorkers: 3,
    });
    expect(unitTestOptions(cpuMax("200000 100000\n"), 12).maxWorkers).toBe(1);
    expect(unitTestOptions(cpuMax("50000 100000\n"), 12).maxWorkers).toBe(1);
  });

  it("leave the pool to Vitest without a quota, or when Node counts the quota already", () => {
    expect(unitTestOptions(machine({}), 12)).toEqual(timeoutsOnly);
    expect(unitTestOptions(cpuMax("max 100000\n"), 12)).toEqual(timeoutsOnly);
    expect(unitTestOptions(machine(v1("cpu", "-1\n", "100000\n")), 12)).toEqual(timeoutsOnly);
    expect(unitTestOptions(cpuMax("400000 100000\n"), 4)).toEqual(timeoutsOnly);
    expect(unitTestOptions(cpuMax("1600000 100000\n"), 12)).toEqual(timeoutsOnly);
  });

  // The machine the tests run on decides the rest: a check container has a quota, this
  // Mac and GitHub's runners have none. Only the shape is certain everywhere.
  it("read the machine they run on", () => {
    const { maxWorkers, ...timeouts } = unitTestOptions();
    expect(timeouts).toEqual(timeoutsOnly);
    const sizes = Array.from({ length: availableParallelism() - 1 }, (_, index) => index + 1);
    expect([undefined, ...sizes]).toContain(maxWorkers);
  });
});
