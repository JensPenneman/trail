import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { cacheFormat } from "../src/cache/cacheFormat";
import { cacheKey, normalizedQueryKey } from "../src/cache/cacheKey";
import { ids } from "./support/fixtures";

const range = { from: "2026-10-26T23:00:00.000Z", to: "2026-10-27T23:00:00.000Z" };

describe("cacheKey", () => {
  it("is the format, the owner and the query's hash", () => {
    const key = cacheKey(ids.user, queryKeys.tracks({ ...range, deviceIds: null }));
    expect(key.startsWith(`${cacheFormat}|${ids.user}|`)).toBe(true);
    expect(key.slice(`${cacheFormat}|${ids.user}|`.length)).toBe(
      JSON.stringify(["tracks", { deviceIds: null, from: range.from, to: range.to }]),
    );
  });

  it("never gives two owners the same key", () => {
    const query = queryKeys.days({ from: "2026-10-01", to: "2026-10-31", deviceIds: null });
    expect(cacheKey(ids.user, query)).not.toBe(cacheKey(ids.ana, query));
  });

  it("is the same for the same devices in another order", () => {
    const one = queryKeys.tracks({ ...range, deviceIds: [ids.phone, ids.car] });
    const other = queryKeys.tracks({ ...range, deviceIds: [ids.car, ids.phone] });
    expect(cacheKey(ids.user, one)).toBe(cacheKey(ids.user, other));
    expect(cacheKey(ids.user, one)).not.toBe(
      cacheKey(ids.user, queryKeys.tracks({ ...range, deviceIds: [ids.phone] })),
    );
  });

  it("tells every other part of the key apart", () => {
    const base = { ...range, deviceIds: null };
    const keys = [
      queryKeys.tracks(base),
      queryKeys.levelTracks({ ...base, level: "inferred" }),
      queryKeys.levelTracks({ ...base, level: "mapped" }),
      queryKeys.tracks({ ...base, to: "2026-10-28T23:00:00.000Z" }),
      queryKeys.heatmap({ bbox: "3.7,51,3.8,51.1", zoom: 12, deviceIds: null }),
      queryKeys.heatmap({ bbox: "3.7,51,3.8,51.1", zoom: 13, deviceIds: null }),
      queryKeys.insightsMode("car", { from: null, to: null, deviceIds: null, mode: null }),
      queryKeys.insightsMode("train", { from: null, to: null, deviceIds: null, mode: null }),
    ];
    expect(new Set(keys.map((key) => cacheKey(ids.user, key))).size).toBe(keys.length);
  });

  it("leaves the key itself as it was", () => {
    const query = queryKeys.tracks({ ...range, deviceIds: [ids.phone, ids.car] });
    const normalized = normalizedQueryKey(query);
    expect(normalized[1]).toEqual({ ...range, deviceIds: [ids.phone, ids.car].sort() });
    expect(query[1].deviceIds).toEqual([ids.phone, ids.car]);
  });
});
