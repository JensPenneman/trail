import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import type { CacheEntry } from "../src/cache/cacheEntry";
import { cacheFormat } from "../src/cache/cacheFormat";
import { cacheKey } from "../src/cache/cacheKey";
import { maxEntryBytes, softBudgetBytes } from "../src/cache/cachePolicy";
import { isProtected, sweepEntries } from "../src/cache/sweepEntries";
import { ids } from "./support/fixtures";

const now = Date.parse("2026-10-28T12:00:00.000Z");
const day = 86_400_000;
const mb = 1024 * 1024;

/** An entry as the store lists it, without its answer. */
function entry(queryKey: readonly unknown[], overrides: Partial<CacheEntry> = {}): CacheEntry {
  const resource = String(queryKey[0]);
  return {
    key: cacheKey(ids.user, queryKey),
    format: cacheFormat,
    owner: ids.user,
    scope: { timezone: "Europe/Brussels" },
    resource,
    queryKey,
    devices: null,
    fetchedAt: now - day,
    touchedAt: now - day,
    until: null,
    expiresAt: null,
    etag: null,
    stamps: null,
    warm: 0,
    bytes: mb,
    ...overrides,
  };
}

/** A past local day of tracks, `daysAgo` before now. */
const pastDay = (daysAgo: number, overrides: Partial<CacheEntry> = {}) => {
  const from = new Date(now - (daysAgo + 1) * day).toISOString();
  const to = new Date(now - daysAgo * day).toISOString();
  return entry(queryKeys.tracks({ from, to, deviceIds: null }), {
    until: Date.parse(to),
    touchedAt: now - daysAgo * 60_000,
    ...overrides,
  });
};

const heat = (index: number) =>
  entry(queryKeys.heatmap({ bbox: `3.${index},51,3.9,51.1`, zoom: 12, deviceIds: null }), {
    touchedAt: now - index * 60_000,
  });

const today = entry(
  queryKeys.tracks({
    from: "2026-10-27T23:00:00.000Z",
    to: "2026-10-28T23:00:00.000Z",
    deviceIds: null,
  }),
  { until: Date.parse("2026-10-28T23:00:00.000Z"), warm: 1, touchedAt: now - 30 * day + 1 },
);
const devices = entry(queryKeys.devices, { warm: 1, touchedAt: now - 2 * day });

describe("sweepEntries", () => {
  it("keeps everything while the store is within its budget and the entries within their TTLs", () => {
    const entries = [today, devices, pastDay(1), heat(1)];
    expect(sweepEntries({ entries, owner: ids.user, now, targetBytes: softBudgetBytes })).toEqual({
      remove: [],
      bytes: 4 * mb,
    });
  });

  it("removes the least recently touched first past the soft budget, settled days before Insights", () => {
    const insights = entry(
      queryKeys.insightsOverview({ from: null, to: null, deviceIds: null, mode: null }),
      { touchedAt: now - 30 * 86_400_000 + 5 },
    );
    const days = Array.from({ length: 36 }, (_, index) => pastDay(index + 1));
    const result = sweepEntries({
      entries: [insights, today, devices, ...days],
      owner: ids.user,
      now,
      targetBytes: softBudgetBytes,
    });
    // 39 MB over 32: the seven settled days touched longest ago go, Insights stays.
    expect(result.remove).toEqual(
      days
        .slice(-7)
        .reverse()
        .map((candidate) => candidate.key),
    );
    expect(result.bytes).toBe(32 * mb);
  });

  it("goes on to Insights, then the rest, but never the warm set or today", () => {
    const insights = entry(
      queryKeys.insightsOverview({ from: null, to: null, deviceIds: null, mode: null }),
      { touchedAt: now - day },
    );
    const result = sweepEntries({
      entries: [insights, today, devices, pastDay(1), heat(1)],
      owner: ids.user,
      now,
      targetBytes: 0,
    });
    expect(result.remove).toEqual([pastDay(1).key, insights.key, heat(1).key]);
    expect(result.bytes).toBe(2 * mb);
    expect(isProtected(today, now)).toBe(true);
    expect(isProtected(devices, now)).toBe(true);
  });

  it("keeps the newest twenty heat views, whatever the budget", () => {
    const views = Array.from({ length: 25 }, (_, index) => heat(index));
    const result = sweepEntries({ entries: views, owner: ids.user, now, targetBytes: 1e12 });
    expect(result.remove).toEqual(views.slice(20).map((view) => view.key));
  });

  it("removes what outlived its TTL, counted from when it was last touched", () => {
    const stale = pastDay(3, { touchedAt: now - 91 * day });
    const fresh = pastDay(4, { touchedAt: now - 89 * day });
    const oldConfig = entry(queryKeys.config, { warm: 1, touchedAt: now - 31 * day });
    const mode = entry(queryKeys.deviceMode(ids.phone), { warm: 1, touchedAt: now - 2 * day });
    const result = sweepEntries({
      entries: [stale, fresh, oldConfig, mode],
      owner: ids.user,
      now,
      targetBytes: softBudgetBytes,
    });
    expect(result.remove.sort()).toEqual([stale.key, oldConfig.key, mode.key].sort());
  });

  it("removes an answer about a day a week after that day ended, however recently touched", () => {
    const formerToday = pastDay(8, {
      touchedAt: now - 60_000,
      expiresAt: now - day,
    });
    expect(
      sweepEntries({ entries: [formerToday], owner: ids.user, now, targetBytes: softBudgetBytes })
        .remove,
    ).toEqual([formerToday.key]);
  });

  it("removes another owner's and another format's entries, and anything over 4 MB", () => {
    const foreign = pastDay(1, { owner: ids.ana, key: `${cacheFormat}|${ids.ana}|x` });
    const older = pastDay(2, { format: cacheFormat - 1, key: `${cacheFormat - 1}|${ids.user}|x` });
    const huge = pastDay(3, { bytes: maxEntryBytes + 1 });
    const unlisted = entry(["people"], { key: "people" });
    const result = sweepEntries({
      entries: [foreign, older, huge, unlisted, today],
      owner: ids.user,
      now,
      targetBytes: softBudgetBytes,
    });
    expect(result.remove.sort()).toEqual([foreign.key, older.key, huge.key, unlisted.key].sort());
  });
});
