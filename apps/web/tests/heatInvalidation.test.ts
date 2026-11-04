import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { type HeatmapParams, queryKeys } from "../src/api/queryKeys";
import { resyncAfterGap } from "../src/live/resyncAfterGap";
import { invalidateStopHeat, staleProcessed } from "../src/live/staleProcessed";
import { sameHeatKind } from "../src/queries/useHeatmap";

const params = (overrides: Partial<HeatmapParams> = {}): HeatmapParams => ({
  bbox: "3.5,50.9,4,51.3",
  zoom: 12,
  deviceIds: null,
  heat: "points",
  mode: null,
  from: null,
  to: null,
  ...overrides,
});

function filled() {
  const client = new QueryClient();
  const kinds = {
    points: params(),
    time: params({ heat: "time", from: "2026-10-01", to: "2026-10-31" }),
    visits: params({ heat: "visits" }),
  };
  for (const kind of Object.values(kinds))
    client.setQueryData(queryKeys.heatmap(kind), { cells: [] });
  const invalidated = (kind: keyof typeof kinds) =>
    client.getQueryState(queryKeys.heatmap(kinds[kind]))?.isInvalidated === true;
  return { client, invalidated };
}

describe("the heat of stops", () => {
  it("goes stale when processing changes a stretch, the heat of points does not", () => {
    const { client, invalidated } = filled();
    staleProcessed(
      client,
      { deviceId: "d", from: "2026-10-20T00:00:00Z", to: "2026-10-21T00:00:00Z" },
      "event",
    );
    expect(invalidated("time")).toBe(true);
    expect(invalidated("visits")).toBe(true);
    expect(invalidated("points")).toBe(false);
  });

  it("goes stale only for the devices and days a change touches", () => {
    const client = new QueryClient();
    const kinds = {
      october: params({ heat: "time", from: "2026-10-01", to: "2026-10-31" }),
      september: params({ heat: "time", from: "2026-09-01", to: "2026-09-30" }),
      allTime: params({ heat: "visits" }),
      other: params({ heat: "time", from: "2026-10-01", to: "2026-10-31", deviceIds: ["b"] }),
      mine: params({ heat: "time", from: "2026-10-01", to: "2026-10-31", deviceIds: ["a", "b"] }),
      points: params(),
    };
    for (const kind of Object.values(kinds)) client.setQueryData(queryKeys.heatmap(kind), {});
    const stale = (name: keyof typeof kinds) =>
      client.getQueryState(queryKeys.heatmap(kinds[name]))?.isInvalidated === true;
    // 20 October in Brussels, device a.
    void invalidateStopHeat(client, {
      deviceId: "a",
      from: "2026-10-20T08:00:00Z",
      to: "2026-10-20T10:00:00Z",
      timezone: "Europe/Brussels",
    });
    expect(stale("october")).toBe(true); // every device, that period
    expect(stale("allTime")).toBe(true); // no period: all history
    expect(stale("mine")).toBe(true);
    expect(stale("september")).toBe(false); // another period
    expect(stale("other")).toBe(false); // another device
    expect(stale("points")).toBe(false);
  });

  it("goes stale after a gap in the live stream too", () => {
    const { client, invalidated } = filled();
    resyncAfterGap(client);
    expect(invalidated("time")).toBe(true);
    expect(invalidated("visits")).toBe(true);
    expect(invalidated("points")).toBe(false);
  });
});

describe("the placeholder of a heat view", () => {
  it("is kept only for the same measure, period and devices", () => {
    const base = params({
      heat: "time",
      from: "2026-10-01",
      to: "2026-10-31",
      deviceIds: ["a", "b"],
    });
    // A pan changes the box and the zoom, nothing else.
    expect(sameHeatKind(params({ ...base, bbox: "1,2,3,4", zoom: 13 }), base)).toBe(true);
    expect(sameHeatKind({ ...base, heat: "visits" }, base)).toBe(false);
    expect(sameHeatKind({ ...base, from: "2026-09-01" }, base)).toBe(false);
    expect(sameHeatKind({ ...base, deviceIds: ["a"] }, base)).toBe(false);
    expect(sameHeatKind({ ...base, deviceIds: null }, { ...base, deviceIds: [] })).toBe(true);
    expect(sameHeatKind(undefined, base)).toBe(false);
    // A key from before the measure existed is no match.
    expect(sameHeatKind({ bbox: "x", zoom: 1, deviceIds: null }, params())).toBe(false);
  });
});
